import type Database from 'better-sqlite3';
import { createId } from '../common/ids';
import { parseRemoteAmountToMicro, parseRemoteBalanceToMinor } from '../common/money';
import {
  MainServiceClient,
  RemoteError,
  createMainServiceClient,
} from '../remote/main-service-client';
import type { SettingsService } from '../settings/settings.service';
import { normalizePage, type PageRequest, type PageResult } from '../common/pagination';

export type SyncStatus = 'fresh' | 'stale' | 'error';

export interface CachedRemoteUser {
  id: string;
  mainUserId: string;
  username: string;
  email: string;
  status: string;
  role: string;
  balanceMinor: number;
  currency: string;
  observedAt: number;
  syncStatus: SyncStatus;
  lastError: string | null;
  source: 'remote';
  isStale: boolean;
}

export class SyncService {
  private remoteClient: { credentialVersion: number; client: MainServiceClient } | null = null;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly settings: SettingsService,
    private readonly createClient = createMainServiceClient,
    private readonly staleAfterMs = 5 * 60 * 1000,
  ) {}

  private client(): MainServiceClient {
    const credentials = this.settings.getCredentials();
    if (this.remoteClient?.credentialVersion === credentials.credentialVersion) {
      return this.remoteClient.client;
    }
    const client = this.createClient(
      credentials.baseUrl,
      credentials.adminEmail,
      credentials.adminPassword,
    );
    this.remoteClient = { credentialVersion: credentials.credentialVersion, client };
    return client;
  }

  listCachedUsers(options: { search?: string; limit?: number } = {}): CachedRemoteUser[] {
    return this.listCachedUsersPage({
      search: options.search,
      page: 1,
      pageSize: options.limit ?? 100,
    }).items;
  }

  listCachedUsersPage(
    options: { search?: string } & PageRequest = {},
  ): PageResult<CachedRemoteUser> {
    const { page, pageSize, offset } = normalizePage(options);
    const search = options.search?.trim();
    const where = search ? 'WHERE username LIKE ? OR email LIKE ? OR main_user_id LIKE ?' : '';
    const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
    const total = Number(
      (this.sqlite.prepare(`SELECT COUNT(*) AS total FROM remote_users ${where}`).get(...params) as { total: number }).total,
    );
    const rows = search
      ? (this.sqlite
          .prepare(
            `SELECT * FROM remote_users
             WHERE username LIKE ? OR email LIKE ? OR main_user_id LIKE ?
             ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
          )
          .all(`%${search}%`, `%${search}%`, `%${search}%`, pageSize, offset) as Array<Record<string, unknown>>)
      : (this.sqlite
          .prepare(`SELECT * FROM remote_users ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`)
          .all(pageSize, offset) as Array<Record<string, unknown>>);
    return { items: rows.map((row) => this.mapUser(row)), page, pageSize, total };
  }

  getCachedUser(mainUserId: string): CachedRemoteUser | null {
    const row = this.sqlite
      .prepare('SELECT * FROM remote_users WHERE main_user_id = ?')
      .get(String(mainUserId)) as Record<string, unknown> | undefined;
    return row ? this.mapUser(row) : null;
  }

  async refreshUsers(params: { search?: string; page?: number; pageSize?: number } = {}) {
    const runId = this.beginRun('users');
    try {
      const client = this.client();
      const { page, pageSize } = normalizePage(params, 25);
      const result = await client.listUsers({
        page,
        pageSize,
        search: params.search,
      });
      const now = Date.now();
      const upsert = this.sqlite.prepare(
        `INSERT INTO remote_users
         (id, main_user_id, username, email, status, role, balance_minor, currency,
          observed_at, sync_status, last_error, raw_json, created_at, updated_at)
         VALUES (@id, @mainUserId, @username, @email, @status, @role, @balanceMinor, @currency,
                 @observedAt, 'fresh', NULL, @rawJson, @createdAt, @updatedAt)
         ON CONFLICT(main_user_id) DO UPDATE SET
           username=excluded.username,
           email=excluded.email,
           status=excluded.status,
           role=excluded.role,
           balance_minor=excluded.balance_minor,
           currency=excluded.currency,
           observed_at=excluded.observed_at,
           sync_status='fresh',
           last_error=NULL,
           raw_json=excluded.raw_json,
           updated_at=excluded.updated_at`,
      );

      const tx = this.sqlite.transaction(() => {
        for (const item of result.items) {
          const mainUserId = String(item.id);
          const existing = this.sqlite
            .prepare('SELECT id, created_at FROM remote_users WHERE main_user_id = ?')
            .get(mainUserId) as { id: string; created_at: number } | undefined;
          upsert.run({
            id: existing?.id ?? createId('ruser'),
            mainUserId,
            username: item.username || '',
            email: item.email || '',
            status: item.status || 'unknown',
            role: item.role || 'user',
            balanceMinor: parseRemoteBalanceToMinor(item.balance ?? 0),
            currency: 'USD',
            observedAt: now,
            rawJson: JSON.stringify(item),
            createdAt: existing?.created_at ?? now,
            updatedAt: now,
          });
        }
      });
      tx();
      this.finishRun(runId, 'success');
      return {
        synced: result.items.length,
        total: result.total,
        users: this.listCachedUsers({ search: params.search }),
      };
    } catch (error) {
      this.finishRun(runId, 'error', error);
      this.markAllStale(error);
      throw error;
    }
  }

  async refreshUser(mainUserId: string) {
    const runId = this.beginRun(`user:${mainUserId}`);
    try {
      const client = this.client();
      const user = await client.getUser(mainUserId);
      const balance = await client.getUserBalance(mainUserId);
      const now = Date.now();
      const existing = this.sqlite
        .prepare('SELECT id, created_at FROM remote_users WHERE main_user_id = ?')
        .get(String(mainUserId)) as { id: string; created_at: number } | undefined;
      this.sqlite
        .prepare(
          `INSERT INTO remote_users
           (id, main_user_id, username, email, status, role, balance_minor, currency,
            observed_at, sync_status, last_error, raw_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'fresh', NULL, ?, ?, ?)
           ON CONFLICT(main_user_id) DO UPDATE SET
             username=excluded.username,
             email=excluded.email,
             status=excluded.status,
             role=excluded.role,
             balance_minor=excluded.balance_minor,
             observed_at=excluded.observed_at,
             sync_status='fresh',
             last_error=NULL,
             raw_json=excluded.raw_json,
             updated_at=excluded.updated_at`,
        )
        .run(
          existing?.id ?? createId('ruser'),
          String(user.id),
          user.username || '',
          user.email || '',
          user.status || 'unknown',
          user.role || 'user',
          balance.balanceMinor,
          balance.currency,
          now,
          JSON.stringify(user),
          existing?.created_at ?? now,
          now,
        );
      this.finishRun(runId, 'success');
      return this.getCachedUser(String(mainUserId));
    } catch (error) {
      this.finishRun(runId, 'error', error);
      this.markUserError(String(mainUserId), error);
      throw error;
    }
  }

  async refreshUsage(mainUserId: string, request: PageRequest = {}) {
    const runId = this.beginRun(`usage:${mainUserId}`);
    try {
      const client = this.client();
      const { page, pageSize } = normalizePage(request);
      const usage = await client.listUsage({ userId: mainUserId, page, pageSize });
      const now = Date.now();
      const upsert = this.sqlite.prepare(
        `INSERT INTO remote_usage_records
         (id, remote_record_id, main_user_id, model, tokens, amount_micro, occurred_at, observed_at, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(remote_record_id) DO UPDATE SET
           model=excluded.model,
           tokens=excluded.tokens,
           amount_micro=excluded.amount_micro,
           observed_at=excluded.observed_at,
           raw_json=excluded.raw_json`,
      );
      const tx = this.sqlite.transaction(() => {
        for (const item of usage.items) {
          const tokens = (item.input_tokens ?? 0) + (item.output_tokens ?? 0);
          const amountMicro = parseRemoteAmountToMicro(item.actual_cost ?? item.total_cost ?? 0);
          const occurredAt = item.created_at ? Date.parse(item.created_at) || now : now;
          upsert.run(
            createId('rusage'),
            String(item.id),
            String(mainUserId),
            item.model || '',
            tokens,
            amountMicro,
            occurredAt,
            now,
            JSON.stringify(item),
          );
        }
      });
      tx();
      this.finishRun(runId, 'success');
      return this.listUsagePage(mainUserId, request);
    } catch (error) {
      this.finishRun(runId, 'error', error);
      throw error;
    }
  }

  listUsage(mainUserId: string, limit = 50) {
    return this.listUsagePage(mainUserId, { page: 1, pageSize: limit }).items;
  }

  listUsagePage(mainUserId: string, request: PageRequest = {}): PageResult<Record<string, unknown>> {
    const { page, pageSize, offset } = normalizePage(request);
    const total = Number(
      (this.sqlite
        .prepare('SELECT COUNT(*) AS total FROM remote_usage_records WHERE main_user_id = ?')
        .get(String(mainUserId)) as { total: number }).total,
    );
    const items = this.sqlite
      .prepare(
        `SELECT id, remote_record_id as remoteRecordId, main_user_id as mainUserId,
                model, tokens, amount_micro as amountMicro,
                occurred_at as occurredAt, observed_at as observedAt
         FROM remote_usage_records
         WHERE main_user_id = ?
         ORDER BY occurred_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(String(mainUserId), pageSize, offset) as Array<Record<string, unknown>>;
    return { items, page, pageSize, total };
  }

  latestSync(scopePrefix = 'users') {
    return this.sqlite
      .prepare(
        `SELECT id, scope, status, started_at as startedAt, finished_at as finishedAt,
                error_code as errorCode, error_message as errorMessage
         FROM sync_runs
         WHERE scope LIKE ?
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get(`${scopePrefix}%`);
  }

  private beginRun(scope: string): string {
    const id = createId('sync');
    this.sqlite
      .prepare(
        `INSERT INTO sync_runs (id, scope, status, started_at, meta_json)
         VALUES (?, ?, 'running', ?, '{}')`,
      )
      .run(id, scope, Date.now());
    return id;
  }

  private finishRun(id: string, status: 'success' | 'error', error?: unknown) {
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    if (error instanceof RemoteError) {
      errorCode = error.code;
      errorMessage = error.message;
    } else if (error instanceof Error) {
      errorCode = 'ERROR';
      errorMessage = error.message;
    }
    this.sqlite
      .prepare(
        `UPDATE sync_runs
         SET status = ?, finished_at = ?, error_code = ?, error_message = ?
         WHERE id = ?`,
      )
      .run(status, Date.now(), errorCode, errorMessage, id);
  }

  private markAllStale(error: unknown) {
    const message = error instanceof Error ? error.message : 'sync failed';
    this.sqlite
      .prepare(
        `UPDATE remote_users
         SET sync_status = 'stale', last_error = ?, updated_at = ?
         WHERE sync_status != 'error'`,
      )
      .run(message, Date.now());
  }

  private markUserError(mainUserId: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'sync failed';
    this.sqlite
      .prepare(
        `UPDATE remote_users
         SET sync_status = 'error', last_error = ?, updated_at = ?
         WHERE main_user_id = ?`,
      )
      .run(message, Date.now(), mainUserId);
  }

  private mapUser(row: Record<string, unknown>): CachedRemoteUser {
    const observedAt = Number(row.observed_at ?? 0);
    const syncStatus = String(row.sync_status ?? 'fresh') as SyncStatus;
    const isStale =
      syncStatus !== 'fresh' || Date.now() - observedAt > this.staleAfterMs;
    return {
      id: String(row.id),
      mainUserId: String(row.main_user_id),
      username: String(row.username ?? ''),
      email: String(row.email ?? ''),
      status: String(row.status ?? 'unknown'),
      role: String(row.role ?? 'user'),
      balanceMinor: Number(row.balance_minor ?? 0),
      currency: String(row.currency ?? 'USD'),
      observedAt,
      syncStatus,
      lastError: (row.last_error as string | null) ?? null,
      source: 'remote',
      isStale,
    };
  }
}
