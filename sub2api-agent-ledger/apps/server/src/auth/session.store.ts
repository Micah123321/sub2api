import { createHash, randomBytes } from 'node:crypto';
import type { AuthRole, SessionUser } from './auth.types';

export const SESSION_COOKIE_NAME = 'sub2api_session';

export interface StoredSession {
  tokenHash: string;
  expiresAt: number;
  userId: string;
  role: AuthRole;
  agentId: string | null;
}

export interface CreatedSession {
  token: string;
  record: StoredSession;
}

export interface SessionStoreOptions {
  now?: () => number;
  tokenBytes?: number;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  private readonly now: () => number;

  private readonly tokenBytes: number;

  constructor(options: SessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.tokenBytes = options.tokenBytes ?? 32;
    if (!Number.isInteger(this.tokenBytes) || this.tokenBytes < 32) {
      throw new RangeError('Session token must contain at least 32 random bytes');
    }
  }

  create(user: SessionUser, ttlMs: number): CreatedSession {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError('Session TTL must be a positive number');
    }

    const token = randomBytes(this.tokenBytes).toString('base64url');
    const record: StoredSession = {
      tokenHash: hashSessionToken(token),
      expiresAt: this.now() + ttlMs,
      userId: user.userId,
      role: user.role,
      agentId: user.agentId,
    };
    this.sessions.set(record.tokenHash, record);
    return { token, record };
  }

  get(token: string): SessionUser | null {
    const tokenHash = hashSessionToken(token);
    const record = this.sessions.get(tokenHash);
    if (!record) {
      return null;
    }

    if (record.expiresAt <= this.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }

    return {
      userId: record.userId,
      role: record.role,
      agentId: record.agentId,
    };
  }

  revoke(token: string): boolean {
    return this.sessions.delete(hashSessionToken(token));
  }

  clearExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [tokenHash, record] of this.sessions) {
      if (record.expiresAt <= now) {
        this.sessions.delete(tokenHash);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.sessions.size;
  }
}
