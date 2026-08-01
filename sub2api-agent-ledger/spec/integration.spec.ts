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
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/api/v1/auth/login')) {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'success',
            data: { access_token: 'jwt-admin', user: { role: 'admin' } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
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
      baseUrl: 'https://main.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'secret',
      fetchImpl,
    });
    const users = await client.listUsers();
    expect(users.total).toBe(1);
    expect(users.items[0].username).toBe('user7');
    expect(requests).toHaveLength(2);
    expect(new Headers(requests[1].init?.headers).get('authorization')).toBe(
      'Bearer jwt-admin',
    );
    expect(requests[0].init?.redirect).toBe('manual');

    let loginCount = 0;
    const unauthorizedFetch: typeof fetch = async (input) => {
      if (String(input).endsWith('/api/v1/auth/login')) {
        loginCount += 1;
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'success',
            data: { access_token: `jwt-${loginCount}`, user: { role: 'admin' } },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ code: 401, message: 'no' }), { status: 401 });
    };
    const badClient = new MainServiceClient({
      baseUrl: 'https://main.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'secret',
      fetchImpl: unauthorizedFetch,
    });
    await expect(badClient.listUsers()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(loginCount).toBe(2);
  });

  it('rejects 2FA and non-admin main-service logins', async () => {
    const twoFactorClient = new MainServiceClient({
      baseUrl: 'https://main.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'secret',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ code: 0, data: { requires_2fa: true, temp_token: 'temp' } }),
          { status: 200 },
        ),
    });
    await expect(twoFactorClient.listUsers()).rejects.toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
    });

    const userClient = new MainServiceClient({
      baseUrl: 'https://main.local',
      adminEmail: 'user@example.com',
      adminPassword: 'secret',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: { access_token: 'jwt-user', user: { role: 'user' } },
          }),
          { status: 200 },
        ),
    });
    await expect(userClient.listUsers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('protects admin credentials in transit and diagnoses Turnstile', async () => {
    expect(
      () =>
        new MainServiceClient({
          baseUrl: 'http://main.example.com',
          adminEmail: 'admin@example.com',
          adminPassword: 'secret',
        }),
    ).toThrow('HTTPS');
    expect(
      () =>
        new MainServiceClient({
          baseUrl: 'http://127.0.0.1:8080',
          adminEmail: 'admin@example.com',
          adminPassword: 'secret',
        }),
    ).not.toThrow();
    expect(
      () =>
        new MainServiceClient({
          baseUrl: 'http://host.docker.internal:8080',
          adminEmail: 'admin@example.com',
          adminPassword: 'secret',
        }),
    ).toThrow('HTTPS');
    expect(
      () =>
        new MainServiceClient({
          baseUrl: 'ftp://main.example.com',
          adminEmail: 'admin@example.com',
          adminPassword: 'secret',
          allowInsecureHttp: true,
        }),
    ).toThrow('HTTP');

    const turnstileClient = new MainServiceClient({
      baseUrl: 'http://main.example.com',
      adminEmail: 'admin@example.com',
      adminPassword: 'secret',
      allowInsecureHttp: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            code: 400,
            reason: 'TURNSTILE_VERIFICATION_FAILED',
            message: 'turnstile verification failed',
          }),
          { status: 400 },
        ),
    });
    await expect(turnstileClient.listUsers()).rejects.toMatchObject({
      code: 'TURNSTILE_REQUIRED',
    });
  });

  it('shares concurrent logins and rejects redirects', async () => {
    let loginCount = 0;
    let expireFirstToken = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/api/v1/auth/login')) {
        loginCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(
          JSON.stringify({
            code: 0,
            data: { access_token: `jwt-${loginCount}`, user: { role: 'admin' } },
          }),
          { status: 200 },
        );
      }
      if (
        expireFirstToken &&
        new Headers(init?.headers).get('authorization') === 'Bearer jwt-1'
      ) {
        return new Response(JSON.stringify({ code: 401, message: 'expired' }), {
          status: 401,
        });
      }
      return new Response(
        JSON.stringify({
          code: 0,
          data: { items: [], total: 0, page: 1, page_size: 20 },
        }),
        { status: 200 },
      );
    };
    const client = new MainServiceClient({
      baseUrl: 'https://main.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'secret',
      fetchImpl,
    });
    await Promise.all([client.listUsers(), client.listUsers(), client.listUsers()]);
    expect(loginCount).toBe(1);
    expireFirstToken = true;
    await Promise.all([client.listUsers(), client.listUsers()]);
    expect(loginCount).toBe(2);

    const redirectClient = new MainServiceClient({
      baseUrl: 'https://main.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'secret',
      fetchImpl: async () =>
        new Response(null, {
          status: 307,
          headers: { location: 'https://attacker.example/login' },
        }),
    });
    await expect(redirectClient.listUsers()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    let maliciousRequestSent = false;
    const pathClient = new MainServiceClient({
      baseUrl: 'https://main.local',
      adminEmail: 'admin@example.com',
      adminPassword: 'secret',
      fetchImpl: async (input) => {
        if (String(input).endsWith('/api/v1/auth/login')) {
          return new Response(
            JSON.stringify({
              code: 0,
              data: { access_token: 'jwt-path', user: { role: 'admin' } },
            }),
            { status: 200 },
          );
        }
        maliciousRequestSent = true;
        return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 });
      },
    });
    await expect(pathClient.getUser('../../auth/login')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(maliciousRequestSent).toBe(false);

    const prefixedRequests: string[] = [];
    const prefixedClient = new MainServiceClient({
      baseUrl: 'https://main.local/sub2api',
      adminEmail: 'admin@example.com',
      adminPassword: 'secret',
      fetchImpl: async (input) => {
        prefixedRequests.push(String(input));
        return new Response(
          JSON.stringify(
            prefixedRequests.length === 1
              ? { code: 0, data: { access_token: 'jwt-prefix', user: { role: 'admin' } } }
              : { code: 0, data: { items: [], total: 0, page: 1, page_size: 20 } },
          ),
          { status: 200 },
        );
      },
    });
    await prefixedClient.listUsers();
    expect(prefixedRequests[0]).toBe('https://main.local/sub2api/api/v1/auth/login');
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
