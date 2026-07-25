import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations, MIGRATION_ID } from '../apps/server/src/db/migrate';

describe('sqlite migrations', () => {
  it('creates required tables and is idempotent', () => {
    const sqlite = new Database(':memory:');
    const first = runMigrations(sqlite);
    expect(first.applied).toEqual([MIGRATION_ID]);
    const second = runMigrations(sqlite);
    expect(second.applied).toEqual([]);

    const tables = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((row: any) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'plugin_users',
        'wallet_accounts',
        'ledger_transactions',
        'cards',
        'agent_user_assignments',
        'remote_users',
        'audit_logs',
        'sessions',
      ]),
    );

    const indexes = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all()
      .map((row: any) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'ledger_transactions_idempotency_uq',
        'cards_code_hash_uq',
        'agent_user_assignments_active_uq',
        'remote_users_main_user_uq',
      ]),
    );
  });
});
