export const AUTH_ROLES = ['ADMIN', 'AGENT'] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export type UserStatus = 'ACTIVE' | 'DISABLED';

export type SameSite = 'lax' | 'strict' | 'none';

export type AuthErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'INVALID_USER'
  | 'PASSWORD_VERIFICATION_FAILED'
  | 'SESSION_REQUIRED'
  | 'SESSION_INVALID'
  | 'FORBIDDEN';

export interface AuthUser {
  id: string;
  username: string;
  passwordHash: string;
  role: AuthRole;
  agentId?: string | null;
  status: UserStatus;
}

export interface SessionUser {
  userId: string;
  role: AuthRole;
  agentId: string | null;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface SessionCookieOptions {
  httpOnly: boolean;
  sameSite: SameSite;
  secure: boolean;
  path: string;
  maxAge: number;
}

export interface SessionCookie {
  name: string;
  value: string;
  options: SessionCookieOptions;
}

export interface AuthResult {
  user: SessionUser;
  cookie: SessionCookie;
}

export interface AuthServiceOptions {
  sessionTtlMs?: number;
  cookieName?: string;
  cookie?: Partial<SessionCookieOptions>;
  sessionStore?: {
    create(user: SessionUser, ttlMs: number): { token: string };
    get(token: string): SessionUser | null;
    revoke(token: string): boolean;
  };
}

export type UserLookup = (
  username: string,
) => AuthUser | null | Promise<AuthUser | null>;

export function isAuthRole(value: string): value is AuthRole {
  return AUTH_ROLES.includes(value as AuthRole);
}

export function hasRole(user: SessionUser, role: AuthRole): boolean {
  return user.role === role;
}

export function hasAnyRole(
  user: SessionUser,
  roles: readonly AuthRole[],
): boolean {
  return roles.length === 0 || roles.includes(user.role);
}

export function canAccessAgent(
  user: SessionUser,
  targetAgentId: string,
): boolean {
  return user.role === 'ADMIN' || user.agentId === targetAgentId;
}

export function getAgentScope(user: SessionUser): string | null {
  return user.role === 'AGENT' ? user.agentId : null;
}
