import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DbSessionStore } from '../auth/db-session.store';
import { verifyPassword } from '../auth/password';
import { UserRepository } from '../auth/user.repository';
import { runMigrations } from '../db/migrate';
import { LedgerService } from '../wallet/ledger';
import { AgentsService } from './agents.service';

describe('AgentsService', () => {
  it('renames an agent and resets its password while revoking existing sessions', async () => {
    const sqlite = new Database(':memory:');
    runMigrations(sqlite);
    const users = new UserRepository(sqlite);
    const sessions = new DbSessionStore(sqlite);
    const service = new AgentsService(sqlite, new LedgerService(sqlite), users, sessions);
    const created = await service.create({ name: 'North', username: 'north', password: 'initial-password' });
    const session = sessions.create({ userId: created.user.id, role: 'AGENT', agentId: created.agent.id }, 60_000);

    await service.update(created.agent.id, { name: 'North One', notes: 'managed' });
    await service.resetPassword(created.agent.id, 'changed-password');

    expect(service.get(created.agent.id)).toMatchObject({ name: 'North One', notes: 'managed' });
    expect(sessions.get(session.token)).toBeNull();
    await expect(verifyPassword(users.findById(created.user.id)!.passwordHash, 'changed-password')).resolves.toBe(true);
  });
});
