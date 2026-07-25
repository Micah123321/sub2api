import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, AuthService } from './auth.service';
import { SESSION_COOKIE_NAME } from './session.store';
import type { SessionUser } from './auth.types';
import { createRequestId } from '../common/ids';
import { ok, fail } from '../http/response';
import { AUTH_SERVICE } from '../app.tokens';
import { LoginRateLimiter } from './login-rate-limit';

interface LoginBody {
  username?: string;
  password?: string;
}

const loginLimiter = new LoginRateLimiter();

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    const ip = request.ip || 'unknown';
    const limitKey = `${ip}:${body.username ?? ''}`;
    const limit = loginLimiter.check(limitKey);
    if (!limit.allowed) {
      reply.status(429);
      return fail('RATE_LIMITED', `登录过于频繁，请 ${limit.retryAfterSec}s 后重试`, requestId);
    }
    try {
      const result = await this.authService.login({
        username: body.username ?? '',
        password: body.password ?? '',
      });
      reply.setCookie(result.cookie.name, result.cookie.value, {
        httpOnly: result.cookie.options.httpOnly,
        sameSite: result.cookie.options.sameSite,
        secure: result.cookie.options.secure,
        path: result.cookie.options.path,
        maxAge: result.cookie.options.maxAge,
      });
      return ok(
        {
          user: {
            userId: result.user.userId,
            role: result.user.role,
            agentId: result.user.agentId,
          },
        },
        requestId,
      );
    } catch (error) {
      if (error instanceof AuthError) {
        const status =
          error.code === 'INVALID_INPUT'
            ? 400
            : error.code === 'ACCOUNT_DISABLED'
              ? 403
              : 401;
        reply.status(status);
        return fail(error.code, error.message, requestId);
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(200)
  logout(
    @Req() request: FastifyRequest & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    this.authService.logout(token);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return ok({ loggedOut: true }, requestId);
  }

  @Get('me')
  me(@Req() request: FastifyRequest & { cookies?: Record<string, string> }) {
    const requestId = createRequestId();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    try {
      const user = this.authService.authenticate(token);
      return ok({ user }, requestId);
    } catch (error) {
      if (error instanceof AuthError) {
        throw new UnauthorizedException(fail(error.code, error.message, requestId));
      }
      throw error;
    }
  }
}

export type { SessionUser };
