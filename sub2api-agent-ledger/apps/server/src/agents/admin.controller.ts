import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { SessionUser } from '../auth/auth.types';
import { AUTH_SERVICE, AGENTS_SERVICE, ASSIGNMENTS_SERVICE, AUDIT_SERVICE, CARDS_SERVICE, LEDGER_SERVICE, SYNC_SERVICE } from '../app.tokens';
import { AgentsService } from './agents.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { AuditService } from '../audit/audit.service';
import { CardsService } from '../cards/cards.service';
import { LedgerService } from '../wallet/ledger';
import { SyncService } from '../sync/sync.service';
import { createRequestId } from '../common/ids';
import { fail, ok } from '../http/response';
import { parseMajorToMinor } from '../common/money';

type AuthedRequest = FastifyRequest & {
  auth?: SessionUser;
  cookies?: Record<string, string>;
};

@Controller('api/admin')
export class AdminController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly authService: AuthService,
    @Inject(AGENTS_SERVICE) private readonly agents: AgentsService,
    @Inject(ASSIGNMENTS_SERVICE) private readonly assignments: AssignmentsService,
    @Inject(LEDGER_SERVICE) private readonly ledger: LedgerService,
    @Inject(CARDS_SERVICE) private readonly cards: CardsService,
    @Inject(SYNC_SERVICE) private readonly sync: SyncService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private requireAdmin(request: AuthedRequest) {
    new AuthGuard(this.authService, { roles: ['ADMIN'] }).canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as never);
  }

  @Get('agents')
  listAgents(@Req() request: AuthedRequest) {
    this.requireAdmin(request);
    return ok(this.agents.list(), createRequestId());
  }

  @Post('agents')
  async createAgent(
    @Req() request: AuthedRequest,
    @Body()
    body: { name?: string; notes?: string; username?: string; password?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      const result = await this.agents.create({
        name: body.name ?? '',
        notes: body.notes,
        username: body.username ?? '',
        password: body.password ?? '',
      });
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: 'agents.create',
        resourceType: 'agent',
        resourceId: result.agent.id,
        payload: { name: result.agent.name, username: result.user.username },
        requestId,
      });
      return ok(
        {
          agent: result.agent,
          user: {
            id: result.user.id,
            username: result.user.username,
            role: result.user.role,
            status: result.user.status,
          },
        },
        requestId,
      );
    } catch (error) {
      reply.status(400);
      return fail('INVALID_INPUT', error instanceof Error ? error.message : '创建失败', requestId);
    }
  }

  @Patch('agents/:id')
  async patchAgent(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { status?: 'ACTIVE' | 'DISABLED'; name?: string; notes?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      const agent = body.status
        ? this.agents.setStatus(id, body.status)
        : await this.agents.update(id, { name: body.name, notes: body.notes });
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: body.status ? 'agents.status' : 'agents.update',
        resourceType: 'agent',
        resourceId: id,
        payload: { status: body.status, name: body.name, notes: body.notes },
        requestId,
      });
      return ok(agent, requestId);
    } catch (error) {
      reply.status(400);
      return fail('INVALID_INPUT', error instanceof Error ? error.message : '更新失败', requestId);
    }
  }

  @Post('agents/:id/password-reset')
  async resetAgentPassword(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { password?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      await this.agents.resetPassword(id, body.password ?? '');
      this.audit.write({ actorId: request.auth?.userId, actorRole: request.auth?.role, action: 'agents.password_reset', resourceType: 'agent', resourceId: id, requestId });
      return ok({ id }, requestId);
    } catch (error) {
      reply.status(400);
      return fail('INVALID_INPUT', error instanceof Error ? error.message : '密码重置失败', requestId);
    }
  }

  @Get('agents/:id/summary')
  agentSummary(@Req() request: AuthedRequest, @Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    const agent = this.agents.get(id);
    if (!agent) {
      reply.status(404);
      return fail('NOT_FOUND', '代理商不存在', requestId);
    }
    return ok(agent, requestId);
  }

  @Get('remote-users')
  async remoteUsers(
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query('search') search?: string,
    @Query('refresh') refresh?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      if (refresh === '1' || refresh === 'true') {
        await this.sync.refreshUsers({ search, page: Number(page) || 1, pageSize: Number(pageSize) || 25 });
      }
      const users = this.sync.listCachedUsersPage({ search, page, pageSize });
      return ok({ users: users.items, page: users, latestSync: this.sync.latestSync() }, requestId);
    } catch (error) {
      reply.status(502);
      return fail(
        'REMOTE_ERROR',
        error instanceof Error ? error.message : '远程同步失败',
        requestId,
      );
    }
  }

  @Post('assignments/batch')
  batchAssign(
    @Req() request: AuthedRequest,
    @Body()
    body: {
      agentId?: string;
      mainUserIds?: string[];
      transfer?: boolean;
      notes?: string;
    },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      if (!body.agentId || !Array.isArray(body.mainUserIds) || body.mainUserIds.length === 0) {
        throw new Error('agentId 与 mainUserIds 必填');
      }
      const results = this.assignments.batchBind({
        agentId: body.agentId,
        mainUserIds: body.mainUserIds,
        operatorId: request.auth?.userId,
        transfer: body.transfer,
        notes: body.notes,
      });
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: 'assignments.batch',
        resourceType: 'assignment',
        resourceId: body.agentId,
        payload: {
          count: body.mainUserIds.length,
          transfer: Boolean(body.transfer),
          success: results.filter((item) => item.status === 'bound' || item.status === 'transferred' || item.status === 'already_bound').length,
        },
        requestId,
      });
      return ok({ results }, requestId);
    } catch (error) {
      reply.status(400);
      return fail('INVALID_INPUT', error instanceof Error ? error.message : '绑定失败', requestId);
    }
  }

  @Get('assignments/history')
  assignmentHistory(
    @Req() request: AuthedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.requireAdmin(request);
    const history = this.assignments.historyPage({ page, pageSize });
    return ok({ assignments: history.items, page: history }, createRequestId());
  }

  @Post('assignments/:id/unbind')
  unbind(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      const record = this.assignments.unbind(id, request.auth?.userId);
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: 'assignments.unbind',
        resourceType: 'assignment',
        resourceId: id,
        requestId,
      });
      return ok(record, requestId);
    } catch (error) {
      reply.status(400);
      return fail('INVALID_INPUT', error instanceof Error ? error.message : '解绑失败', requestId);
    }
  }

  @Get('wallets/:agentId')
  getWallet(@Req() request: AuthedRequest, @Param('agentId') agentId: string) {
    this.requireAdmin(request);
    const wallet = this.ledger.ensureWallet(agentId);
    return ok({ ...wallet, source: 'local' }, createRequestId());
  }

  @Post('wallets/:agentId/adjust')
  adjustWallet(
    @Req() request: AuthedRequest,
    @Param('agentId') agentId: string,
    @Body()
    body: {
      operation?: 'add' | 'subtract' | 'set';
      amount?: number | string;
      amountMinor?: number;
      idempotencyKey?: string;
      notes?: string;
    },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      if (!body.idempotencyKey || !body.idempotencyKey.trim()) {
        throw new Error('idempotencyKey 必填，禁止隐式随机键导致重试重复入账');
      }
      const amountMinor =
        body.amountMinor != null
          ? body.amountMinor
          : parseMajorToMinor(body.amount ?? 0);
      const result = this.ledger.adjust({
        agentId,
        operation: body.operation ?? 'add',
        amountMinor,
        idempotencyKey: body.idempotencyKey.trim(),
        operatorId: request.auth?.userId,
        notes: body.notes,
      });
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: 'wallet.adjust',
        resourceType: 'wallet',
        resourceId: result.wallet.id,
        payload: {
          operation: body.operation,
          amountMinor,
          balanceAfter: result.wallet.balanceMinor,
          replayed: result.replayed,
        },
        requestId,
      });
      return ok({ ...result, source: 'local' }, requestId);
    } catch (error) {
      reply.status(400);
      return fail('LEDGER_ERROR', error instanceof Error ? error.message : '余额调整失败', requestId);
    }
  }

  @Get('wallets/:agentId/ledger')
  walletLedger(
    @Req() request: AuthedRequest,
    @Param('agentId') agentId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.requireAdmin(request);
    const wallet = this.ledger.ensureWallet(agentId);
    return ok(
      {
        wallet: { ...wallet, source: 'local' },
        transactions: this.ledger.listTransactionsPage(wallet.id, { page, pageSize }),
      },
      createRequestId(),
    );
  }

  @Get('cards')
  listCards(
    @Req() request: AuthedRequest,
    @Query('agentId') agentId?: string,
    @Query('batchId') batchId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.requireAdmin(request);
    return ok(
      {
        batches: this.cards.listBatches(agentId),
        cards: this.cards.listCardsPage({ agentId, batchId, status }, { page, pageSize }),
      },
      createRequestId(),
    );
  }

  @Post('cards/batches')
  createCardBatch(
    @Req() request: AuthedRequest,
    @Body()
    body: {
      agentId?: string;
      count?: number;
      value?: number | string;
      valueMinor?: number;
      idempotencyKey?: string;
    },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      if (!body.agentId) {
        throw new Error('agentId 必填');
      }
      if (!body.idempotencyKey?.trim()) {
        throw new Error('idempotencyKey 必填');
      }
      const valueMinor =
        body.valueMinor != null ? body.valueMinor : parseMajorToMinor(body.value ?? 0);
      const result = this.cards.issueBatch({
        agentId: body.agentId,
        count: body.count ?? 0,
        valueMinor,
        createdBy: request.auth?.userId,
        idempotencyKey: body.idempotencyKey,
      });
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: 'cards.batch_create',
        resourceType: 'card_batch',
        resourceId: result.batch.id,
        payload: {
          agentId: body.agentId,
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
      return fail('INVALID_INPUT', error instanceof Error ? error.message : '生成卡密失败', requestId);
    }
  }

  @Post('cards/:id/revoke')
  revokeCard(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      const card = this.cards.revoke(id);
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: 'cards.revoke',
        resourceType: 'card',
        resourceId: id,
        requestId,
      });
      return ok(card, requestId);
    } catch (error) {
      reply.status(400);
      return fail('INVALID_INPUT', error instanceof Error ? error.message : '失效失败', requestId);
    }
  }

  @Post('cards/:id/redeem')
  redeemCardAsAdmin(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { code?: string; agentId?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const requestId = createRequestId();
    this.requireAdmin(request);
    try {
      const card = this.cards.getCard(id);
      if (!card) {
        throw new Error('卡密不存在');
      }
      if (!body.code) {
        throw new Error('核销需要完整卡密明文');
      }
      const result = this.cards.redeem({
        code: body.code,
        agentId: body.agentId || card.agentId,
        operatorId: request.auth?.userId,
      });
      this.audit.write({
        actorId: request.auth?.userId,
        actorRole: request.auth?.role,
        action: 'cards.redeem',
        resourceType: 'card',
        resourceId: id,
        payload: { replayed: result.replayed },
        requestId,
      });
      return ok(result, requestId);
    } catch (error) {
      reply.status(400);
      return fail('INVALID_INPUT', error instanceof Error ? error.message : '核销失败', requestId);
    }
  }

  @Get('audit-logs')
  auditLogs(
    @Req() request: AuthedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.requireAdmin(request);
    return ok(this.audit.listPage({ page, pageSize }), createRequestId());
  }

  @Get('overview')
  overview(@Req() request: AuthedRequest) {
    this.requireAdmin(request);
    const agents = this.agents.list();
    return ok(
      {
        agentCount: agents.length,
        activeAgents: agents.filter((item) => item.status === 'ACTIVE').length,
        bindingCount: agents.reduce((sum, item) => sum + item.activeBindings, 0),
        localBalanceMinor: agents.reduce((sum, item) => sum + item.walletBalanceMinor, 0),
        latestSync: this.sync.latestSync(),
        sourceLegend: {
          remote: '主服务只读缓存',
          local: '插件本地账本',
        },
      },
      createRequestId(),
    );
  }
}
