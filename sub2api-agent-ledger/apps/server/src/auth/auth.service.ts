import {
  AuthErrorCode,
  type AuthResult,
  type AuthServiceOptions,
  type AuthUser,
  type LoginCredentials,
  type SessionCookie,
  type SessionCookieOptions,
  type SessionUser,
  hasAnyRole,
  isAuthRole,
  type AuthRole,
  type UserLookup,
} from './auth.types';
import { verifyPassword } from './password';
import { SESSION_COOKIE_NAME, SessionStore } from './session.store';

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AuthError';
  }
}

export class AuthService {
  private readonly sessionTtlMs: number;

  private readonly cookieName: string;

  private readonly cookieOptions: SessionCookieOptions;

  private readonly sessionStore: NonNullable<AuthServiceOptions['sessionStore']>;

  constructor(
    private readonly findUser: UserLookup,
    options: AuthServiceOptions = {},
  ) {
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.cookieName = options.cookieName ?? SESSION_COOKIE_NAME;
    this.cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      secure: resolveSessionCookieSecure(),
      path: '/',
      maxAge: Math.floor(this.sessionTtlMs / 1000),
      ...options.cookie,
    };
    this.sessionStore = options.sessionStore ?? new SessionStore();
  }

  async login(credentials: LoginCredentials): Promise<AuthResult> {
    if (!credentials.username || !credentials.password) {
      throw new AuthError('INVALID_INPUT', '用户名和密码不能为空');
    }

    const user = await this.findUser(credentials.username);
    if (!user) {
      throw new AuthError('INVALID_CREDENTIALS', '用户名或密码错误');
    }

    if (user.status !== 'ACTIVE') {
      throw new AuthError('ACCOUNT_DISABLED', '账户已被禁用');
    }

    let passwordMatches: boolean;
    try {
      passwordMatches = await verifyPassword(user.passwordHash, credentials.password);
    } catch (error) {
      throw new AuthError(
        'PASSWORD_VERIFICATION_FAILED',
        '密码校验失败',
        { cause: error },
      );
    }

    if (!passwordMatches) {
      throw new AuthError('INVALID_CREDENTIALS', '用户名或密码错误');
    }

    const sessionUser = toSessionUser(user);
    const { token } = this.sessionStore.create(sessionUser, this.sessionTtlMs);
    return {
      user: sessionUser,
      cookie: this.createCookie(token),
    };
  }

  authenticate(token: string | undefined): SessionUser {
    if (!token) {
      throw new AuthError('SESSION_REQUIRED', '需要登录');
    }

    const session = this.sessionStore.get(token);
    if (!session) {
      throw new AuthError('SESSION_INVALID', '会话无效或已过期');
    }

    return session;
  }

  logout(token: string | undefined): boolean {
    return token ? this.sessionStore.revoke(token) : false;
  }

  hasRoles(session: SessionUser, roles: readonly AuthRole[]): boolean {
    return hasAnyRole(session, roles);
  }

  private createCookie(token: string): SessionCookie {
    return {
      name: this.cookieName,
      value: token,
      options: { ...this.cookieOptions },
    };
  }
}

function toSessionUser(user: AuthUser): SessionUser {
  if (!isAuthRole(user.role) || !user.id) {
    throw new AuthError('INVALID_USER', '用户记录无效');
  }

  const agentId = user.agentId ?? null;
  if (user.role === 'AGENT' && !agentId) {
    throw new AuthError('INVALID_USER', '代理商账户缺少 agentId');
  }

  return {
    userId: user.id,
    role: user.role,
    agentId,
  };
}

function resolveSessionCookieSecure(): boolean {
  const configured = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (configured === 'true') {
    return true;
  }
  if (configured === 'false') {
    return false;
  }
  return process.env.NODE_ENV === 'production';
}
