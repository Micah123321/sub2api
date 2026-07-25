import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { SessionUser } from '../auth/auth.types';
import { createRequestId } from '../common/ids';
import { ok, fail } from '../http/response';
import { AUTH_SERVICE, SETTINGS_SERVICE } from '../app.tokens';
import { SettingsError, SettingsService } from './settings.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_SERVICE } from '../app.tokens';

@Controller('api/settings')
export class SettingsController {
  constructor(
    @Inject(SETTINGS_SERVICE) private readonly settings: SettingsService,
    @Inject(AUTH_SERVICE) private readonly authService: AuthService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private adminGuard() {
    return new AuthGuard(this.authService, { roles: ['ADMIN'] });
  }

  @Get('main-service')
  @UseGuards()
  getMainService(
    @Req() request: FastifyRequest & { auth?: SessionUser; cookies?: Record<string, string> },
  ) {
    // manual guard because Nest custom provider guards need DI wiring
    this.adminGuard().canActivate({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as never);
    return ok(this.settings.getView(), createRequestId());
  }

  @Put('main-service')
  saveMainService(
    @Req() request: FastifyRequest & { auth?: SessionUser; cookies?: Record<string, string> },
    @Body() body: { baseUrl?: string; apiKey?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.adminGuard().canActivate({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as never);

    try {
      const view = this.settings.save({
        baseUrl: body.baseUrl ?? '',
        apiKey: body.apiKey,
        updatedBy: request.auth?.userId ?? null,
      });
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: 'settings.main_service.update',
        resourceType: 'main_service_settings',
        payload: { baseUrl: view.baseUrl, keyVersion: view.keyVersion },
        requestId,
      });
      return ok(view, requestId);
    } catch (error) {
      if (error instanceof SettingsError) {
        reply.status(400);
        return fail(error.code, error.message, requestId);
      }
      throw error;
    }
  }

  @Post('main-service/test')
  async testMainService(
    @Req() request: FastifyRequest & { auth?: SessionUser; cookies?: Record<string, string> },
    @Body() body: { baseUrl?: string; apiKey?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.adminGuard().canActivate({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as never);

    try {
      const result = await this.settings.testConnection({
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
      });
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: 'settings.main_service.test',
        resourceType: 'main_service_settings',
        payload: { ok: result.ok, status: result.status, errorCode: result.errorCode },
        requestId,
      });
      return ok(result, requestId);
    } catch (error) {
      if (error instanceof SettingsError) {
        reply.status(400);
        return fail(error.code, error.message, requestId);
      }
      throw error;
    }
  }
}
