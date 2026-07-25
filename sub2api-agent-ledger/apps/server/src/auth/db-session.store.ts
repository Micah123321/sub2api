import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthRole, SessionUser } from '../auth/auth.types';

export interface DbSessionStoreOptions {
  now?: () => number;
  tokenBytes?: number;
}

export class DbSessionStore {
  private readonly now: () => number;
  private readonly tokenBytes: number;

  constructor(
    private readonly sqlite: Database.Database,
    options: DbSessionStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.tokenBytes = options.tokenBytes ?? 32;
  }

  create(user: SessionUser, ttlMs: number): { token: string } {
    const token = randomBytes(this.tokenBytes).toString('base64url');
    const tokenHash = hashToken(token);
    const now = this.now();
    this.sqlite
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, role, agent_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(tokenHash, user.userId, user.role, user.agentId, now + ttlMs, now);
    return { token };
  }

  get(token: string): SessionUser | null {
    const tokenHash = hashToken(token);
    const row = this.sqlite
      .prepare(
        `SELECT user_id as userId, role, agent_id as agentId, expires_at as expiresAt
         FROM sessions WHERE token_hash = ?`,
      )
      .get(tokenHash) as
      | { userId: string; role: AuthRole; agentId: string | null; expiresAt: number }
      | undefined;
    if (!row) {
      return null;
    }
    if (row.expiresAt <= this.now()) {
      this.sqlite.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return {
      userId: row.userId,
      role: row.role,
      agentId: row.agentId,
    };
  }

  revoke(token: string): boolean {
    const result = this.sqlite
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .run(hashToken(token));
    return result.changes > 0;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
