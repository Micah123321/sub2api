import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  runMigrations,
  MIGRATION_ID,
  MIGRATION_PAID_CARD_ISSUE_ID,
  MIGRATION_USAGE_MICRO_ID,
} from '../apps/server/src/db/migrate';

describe('sqlite migrations', () => {
  it('creates required tables and is idempotent', () => {
    const sqlite = new Database(':memory:');
    const first = runMigrations(sqlite);
    expect(first.applied).toEqual([
      MIGRATION_ID,
      MIGRATION_USAGE_MICRO_ID,
      MIGRATION_PAID_CARD_ISSUE_ID,
    ]);
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
        'card_batches_idempotency_uq',
        'ledger_transactions_batch_idx',
      ]),
    );
  });

  it('upgrades a legacy database that still has remote_usage_records.amount_minor', () => {
    const sqlite = new Database(':memory:');
    // 模拟只跑过 0001 的旧库：用旧列名建表并标记 0001 已应用。
    sqlite.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE remote_usage_records (
        id TEXT PRIMARY KEY,
        remote_record_id TEXT NOT NULL,
        main_user_id TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        tokens INTEGER NOT NULL DEFAULT 0,
        amount_minor INTEGER NOT NULL DEFAULT 0,
        occurred_at INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        raw_json TEXT
      );
      CREATE UNIQUE INDEX remote_usage_records_remote_id_uq ON remote_usage_records(remote_record_id);
      CREATE INDEX remote_usage_records_user_idx ON remote_usage_records(main_user_id);
      CREATE TABLE ledger_transactions (
        id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, type TEXT NOT NULL,
        amount_minor INTEGER NOT NULL, balance_before INTEGER NOT NULL,
        balance_after INTEGER NOT NULL, idempotency_key TEXT NOT NULL,
        operator_id TEXT, notes TEXT NOT NULL DEFAULT '', related_card_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE card_batches (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, count INTEGER NOT NULL,
        value_minor INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_by TEXT, created_at INTEGER NOT NULL
      );
    `);
    sqlite
      .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      .run(MIGRATION_ID, Date.now());

    const applied = runMigrations(sqlite);
    expect(applied.applied).toEqual([
      MIGRATION_USAGE_MICRO_ID,
      MIGRATION_PAID_CARD_ISSUE_ID,
    ]);

    const columns = (
      sqlite.prepare(`PRAGMA table_info(remote_usage_records)`).all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(columns).toContain('amount_micro');
    expect(columns).not.toContain('amount_minor');

    const batchColumns = (
      sqlite.prepare(`PRAGMA table_info(card_batches)`).all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(batchColumns).toEqual(expect.arrayContaining(['idempotency_key', 'request_fingerprint']));

    const ledgerColumns = (
      sqlite.prepare(`PRAGMA table_info(ledger_transactions)`).all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(ledgerColumns).toContain('related_batch_id');

    // 重建后唯一索引必须仍然存在，否则同步的 ON CONFLICT 会退化成重复插入。
    const indexes = (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'remote_usage_records_remote_id_uq',
        'remote_usage_records_user_idx',
      ]),
    );

    expect(runMigrations(sqlite).applied).toEqual([]);
  });
});
