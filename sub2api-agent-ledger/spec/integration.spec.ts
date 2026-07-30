import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../apps/server/src/db/migrate';
import { MainServiceClient } from '../apps/server/src/remote/main-service-client';
import { AssignmentsService } from '../apps/server/src/assignments/assignments.service';
import { LedgerService } from '../apps/server/src/wallet/ledger';
import { CardsService } from '../apps/server/src/cards/cards.service';
import { AuditService, redactPayload } from '../apps/server/src/audit/audit.service';
import { canAccessAgent } from '../apps/server/src/auth/auth.types';

describe('integration: remote client and security', () => {
  it('maps remote envelope and rejects unregistered paths', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/api/v1/admin/users?')) {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              items: [
                {
                  id: 7,
                  email: 'u@example.com',
                  username: 'user7',
                  status: 'active',
                  balance: 12.5,
                },
              ],
              total: 1,
              page: 1,
              page_size: 20,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('no', { status: 404 });
    };

    const client = new MainServiceClient({
      baseUrl: 'http://main.local',
      apiKey: 'secret',
      fetchImpl,
    });
    const users = await client.listUsers();
    expect(users.total).toBe(1);
    expect(users.items[0].username).toBe('user7');

    const unauthorizedFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ code: 401, message: 'no' }), { status: 401 });
    const badClient = new MainServiceClient({
      baseUrl: 'http://main.local',
      apiKey: 'secret',
      fetchImpl: unauthorizedFetch,
    });
    await expect(badClient.listUsers()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('supports batch bind conflict and transfer semantics', () => {
    const sqlite = new Database(':memory:');
    runMigrations(sqlite);
    const assignments = new AssignmentsService(sqlite);
    const first = assignments.batchBind({
      agentId: 'a1',
      mainUserIds: ['u1', 'u2'],
    });
    expect(first.every((item) => item.status === 'bound')).toBe(true);

    const conflict = assignments.batchBind({
      agentId: 'a2',
      mainUserIds: ['u1'],
    });
    expect(conflict[0].status).toBe('conflict');

    const transferred = assignments.batchBind({
      agentId: 'a2',
      mainUserIds: ['u1'],
      transfer: true,
    });
    expect(transferred[0].status).toBe('transferred');
    expect(assignments.listActive('a2').map((item) => item.mainUserId)).toEqual(['u1']);
  });

  it('redeems cards once and redacts secrets in audit payload', () => {
    const sqlite = new Database(':memory:');
    runMigrations(sqlite);
    const ledger = new LedgerService(sqlite);
    const cards = new CardsService(sqlite, ledger);
    const audit = new AuditService(sqlite);

    ledger.adjust({
      agentId: 'agent-x',
      operation: 'add',
      amountMinor: 1500,
      idempotencyKey: 'seed-agent-x',
    });
    const batch = cards.issueBatch({
      agentId: 'agent-x',
      count: 1,
      valueMinor: 1500,
      idempotencyKey: 'issue-agent-x',
    });
    const code = batch.cards[0].code;
    const first = cards.redeem({ code, agentId: 'agent-x', operatorId: 'op' });
    const second = cards.redeem({ code, agentId: 'agent-x', operatorId: 'op' });
    expect(first.wallet?.balanceMinor).toBe(1500);
    expect(second.replayed).toBe(true);
    expect(ledger.getWalletByAgent('agent-x')?.balanceMinor).toBe(1500);

    const redacted = redactPayload({
      apiKey: 'super-secret',
      password: 'pwd',
      nested: { cardCode: 'ABCD' },
      safe: 'ok',
    });
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect((redacted.nested as any).cardCode).toBe('[REDACTED]');
    expect(redacted.safe).toBe('ok');

    audit.write({
      action: 'test',
      resourceType: 'demo',
      payload: { apiKey: 'abc', note: 'x' },
    });
    const logs = audit.list(1);
    expect(String(logs[0].payloadJson)).toContain('[REDACTED]');
    expect(String(logs[0].payloadJson)).not.toContain('abc');
  });

  it('issues cards from the local wallet atomically and replays idempotently', () => {
    const sqlite = new Database(':memory:');
    runMigrations(sqlite);
    const ledger = new LedgerService(sqlite);
    const cards = new CardsService(sqlite, ledger);
    ledger.adjust({
      agentId: 'agent-issue',
      operation: 'add',
      amountMinor: 5_000,
      idempotencyKey: 'seed-agent-issue',
    });

    const created = cards.issueBatch({
      agentId: 'agent-issue',
      count: 2,
      valueMinor: 1_000,
      idempotencyKey: 'issue-1',
    });
    expect(created.replayed).toBe(false);
    expect(created.cards).toHaveLength(2);
    expect(created.wallet?.balanceMinor).toBe(3_000);
    expect(created.transaction.type).toBe('CARD_ISSUE');

    const replayed = cards.issueBatch({
      agentId: 'agent-issue',
      count: 2,
      valueMinor: 1_000,
      idempotencyKey: 'issue-1',
    });
    expect(replayed.replayed).toBe(true);
    expect(replayed.cards).toHaveLength(0);
    expect(replayed.wallet?.balanceMinor).toBe(3_000);

    expect(() =>
      cards.issueBatch({
        agentId: 'agent-issue',
        count: 3,
        valueMinor: 1_000,
        idempotencyKey: 'issue-1',
      }),
    ).toThrow('幂等键');
    expect(() =>
      cards.issueBatch({
        agentId: 'agent-issue',
        count: 10,
        valueMinor: 1_000,
        idempotencyKey: 'insufficient',
      }),
    ).toThrow('余额不足');
    expect(cards.listBatches('agent-issue')).toHaveLength(1);
    expect(ledger.getWalletByAgent('agent-issue')?.balanceMinor).toBe(3_000);
  });

  it('enforces agent scope helper', () => {
    expect(
      canAccessAgent({ userId: '1', role: 'AGENT', agentId: 'a1' }, 'a1'),
    ).toBe(true);
    expect(
      canAccessAgent({ userId: '1', role: 'AGENT', agentId: 'a1' }, 'a2'),
    ).toBe(false);
  });
});
