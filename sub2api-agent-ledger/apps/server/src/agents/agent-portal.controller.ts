import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthGuard, assertAgentAccess } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { SessionUser } from '../auth/auth.types';
import {
  ASSIGNMENTS_SERVICE,
  AUDIT_SERVICE,
  AUTH_SERVICE,
  CARDS_SERVICE,
  LEDGER_SERVICE,
  SYNC_SERVICE,
} from '../app.tokens';
import { AssignmentsService } from '../assignments/assignments.service';
import { AuditService } from '../audit/audit.service';
import { CardsService } from '../cards/cards.service';
import { LedgerService } from '../wallet/ledger';
import { SyncService } from '../sync/sync.service';
import { createRequestId } from '../common/ids';
import { fail, ok } from '../http/response';

type AuthedRequest = FastifyRequest & {
  auth?: SessionUser;
  cookies?: Record<string, string>;
};

@Controller('api/agent')
export class AgentPortalController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly authService: AuthService,
    @Inject(ASSIGNMENTS_SERVICE) private readonly assignments: AssignmentsService,
    @Inject(LEDGER_SERVICE) private readonly ledger: LedgerService,
    @Inject(CARDS_SERVICE) private readonly cards: CardsService,
    @Inject(SYNC_SERVICE) private readonly sync: SyncService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private requireAgent(request: AuthedRequest): SessionUser {
    new AuthGuard(this.authService, { roles: ['AGENT', 'ADMIN'] }).canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as never);
    const session = request.auth!;
    if (session.role === 'AGENT' && !session.agentId) {
      throw new Error('代理商会话缺少 agentId');
    }
    return session;
  }

  private resolveAgentId(session: SessionUser, requested?: string): string {
    if (session.role === 'ADMIN') {
      if (!requested) {
        throw new Error('管理员访问代理商接口时需要 agentId');
      }
      return requested;
    }
    const agentId = session.agentId!;
    if (requested) {
      assertAgentAccess(session, requested);
    }
    return agentId;
  }

  @Get('me')
  me(@Req() request: AuthedRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const requestId = createRequestId();
    try {
      const session = this.requireAgent(request);
      return ok(
        {
          userId: session.userId,
          role: session.role,
          agentId: session.agentId,
        },
        requestId,
      );
    } catch (error) {
      reply.status(401);
      return fail('UNAUTHORIZED', error instanceof Error ? error.message : '未授权', requestId);
    }
  }

  @Get('users')
  users(
    @Req() request: AuthedRequest,
    @Query('agentId') agentIdQuery: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    try {
      const session = this.requireAgent(request);
      const agentId = this.resolveAgentId(session, agentIdQuery);
      const bindings = this.assignments.listActive(agentId);
      const users = bindings.map((binding) => {
        const remote = this.sync.getCachedUser(binding.mainUserId);
        return {
          assignmentId: binding.id,
          mainUserId: binding.mainUserId,
          boundAt: binding.boundAt,
          remote: remote
            ? {
                ...remote,
                source: 'remote' as const,
              }
            : null,
        };
      });
      return ok({ agentId, users }, requestId);
    } catch (error) {
      reply.status(403);
      return fail('FORBIDDEN', error instanceof Error ? error.message : '无权访问', requestId);
    }
  }

  @Get('users/:userId')
  async userDetail(
    @Req() request: AuthedRequest,
    @Param('userId') userId: string,
    @Query('agentId') agentIdQuery: string | undefined,
    @Query('refresh') refresh: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    try {
      const session = this.requireAgent(request);
      const agentId = this.resolveAgentId(session, agentIdQuery);
      const binding = this.assignments
        .listActive(agentId)
        .find((item) => item.mainUserId === String(userId));
      if (!binding) {
        reply.status(404);
        return fail('NOT_FOUND', '用户未绑定到当前代理商', requestId);
      }

      let remote = this.sync.getCachedUser(userId);
      let usage = this.sync.listUsage(userId);
      let remoteError: string | null = null;
      if (refresh === '1' || refresh === 'true') {
        try {
          remote = await this.sync.refreshUser(userId);
          usage = await this.sync.refreshUsage(userId);
        } catch (error) {
          remoteError = error instanceof Error ? error.message : '刷新失败';
          remote = this.sync.getCachedUser(userId);
          usage = this.sync.listUsage(userId);
        }
      }

      return ok(
        {
          assignment: binding,
          remote: remote
            ? {
                ...remote,
                source: 'remote' as const,
              }
            : null,
          usage: (usage as Array<Record<string, unknown>>).map((item) => ({
            ...item,
            source: 'remote' as const,
          })),
          remoteError,
        },
        requestId,
      );
    } catch (error) {
      reply.status(403);
      return fail('FORBIDDEN', error instanceof Error ? error.message : '无权访问', requestId);
    }
  }

  @Get('wallet')
  wallet(
    @Req() request: AuthedRequest,
    @Query('agentId') agentIdQuery: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    try {
      const session = this.requireAgent(request);
      const agentId = this.resolveAgentId(session, agentIdQuery);
      const wallet = this.ledger.ensureWallet(agentId);
      return ok(
        {
          wallet: { ...wallet, source: 'local' as const },
          transactions: this.ledger.listTransactions(wallet.id, 30),
        },
        requestId,
      );
    } catch (error) {
      reply.status(403);
      return fail('FORBIDDEN', error instanceof Error ? error.message : '无权访问', requestId);
    }
  }

  @Post('cards/redeem')
  redeem(
    @Req() request: AuthedRequest,
    @Body() body: { code?: string; agentId?: string; idempotencyKey?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    try {
      const session = this.requireAgent(request);
      const agentId = this.resolveAgentId(session, body.agentId);
      const result = this.cards.redeem({
        code: body.code ?? '',
        agentId,
        operatorId: session.userId,
        idempotencyKey: body.idempotencyKey,
      });
      this.audit.write({
        actorId: session.userId,
        actorRole: session.role,
        action: 'cards.redeem',
        resourceType: 'card',
        resourceId: result.card.id,
        payload: { replayed: result.replayed, agentId },
        requestId,
      });
      return ok(result, requestId);
    } catch (error) {
      reply.status(400);
      return fail('REDEEM_FAILED', error instanceof Error ? error.message : '核销失败', requestId);
    }
  }

  @Post('cards/batches')
  issueCards(
    @Req() request: AuthedRequest,
    @Body()
    body: {
      count?: number;
      valueMinor?: number;
      idempotencyKey?: string;
    },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    try {
      const session = this.requireAgent(request);
      if (session.role !== 'AGENT') {
        throw new Error('管理员请使用管理端发卡接口');
      }
      const agentId = this.resolveAgentId(session);
      const result = this.cards.issueBatch({
        agentId,
        count: body.count ?? 0,
        valueMinor: body.valueMinor ?? 0,
        idempotencyKey: body.idempotencyKey ?? '',
        createdBy: session.userId,
      });
      this.audit.write({
        actorId: session.userId,
        actorRole: session.role,
        action: result.replayed ? 'cards.issue_replayed' : 'cards.issue',
        resourceType: 'card_batch',
        resourceId: result.batch.id,
        payload: {
          agentId,
          count: result.batch.count,
          valueMinor: result.batch.valueMinor,
          balanceAfter: result.wallet?.balanceMinor,
          replayed: result.replayed,
        },
        requestId,
      });
      return ok(result, requestId);
    } catch (error) {
      reply.status(400);
      return fail('ISSUE_FAILED', error instanceof Error ? error.message : '创建卡密失败', requestId);
    }
  }
}
