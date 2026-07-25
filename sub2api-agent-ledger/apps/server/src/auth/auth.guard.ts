import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthRole, SessionUser } from './auth.types';
import { canAccessAgent, hasAnyRole } from './auth.types';
import { AuthError, AuthService } from './auth.service';
import { SESSION_COOKIE_NAME } from './session.store';

export interface AuthenticatedRequest {
  auth?: SessionUser;
  session?: SessionUser;
  cookies?: Record<string, string | undefined>;
  headers?: { cookie?: string };
  params?: Record<string, string | undefined>;
}

export interface AuthGuardOptions {
  roles?: readonly AuthRole[];
  cookieName?: string;
}

export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly options: AuthGuardOptions = {},
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionCookie(
      request,
      this.options.cookieName ?? SESSION_COOKIE_NAME,
    );

    let session: SessionUser;
    try {
      session = this.authService.authenticate(token);
    } catch (error) {
      if (error instanceof AuthError) {
        throw new UnauthorizedException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    if (!hasAnyRole(session, this.options.roles ?? [])) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '当前角色无权执行此操作',
      });
    }

    request.auth = session;
    request.session = session;
    return true;
  }
}

export class RoleGuard implements CanActivate {
  constructor(private readonly roles: readonly AuthRole[]) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException({
        code: 'SESSION_REQUIRED',
        message: '需要登录',
      });
    }

    if (!hasAnyRole(request.auth, this.roles)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '当前角色无权执行此操作',
      });
    }

    return true;
  }
}

export function assertAgentAccess(
  session: SessionUser,
  targetAgentId: string,
): void {
  if (!canAccessAgent(session, targetAgentId)) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: '代理商只能访问自己的资源',
    });
  }
}

function readSessionCookie(
  request: AuthenticatedRequest,
  cookieName: string,
): string | undefined {
  const cookieValue = request.cookies?.[cookieName];
  if (cookieValue) {
    return cookieValue;
  }

  return parseCookieHeader(request.headers?.cookie, cookieName);
}

function parseCookieHeader(
  header: string | undefined,
  cookieName: string,
): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    if (name !== cookieName) {
      continue;
    }

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}
