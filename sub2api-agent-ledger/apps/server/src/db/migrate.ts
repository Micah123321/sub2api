import type Database from 'better-sqlite3';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS plugin_users_username_uq ON plugin_users(username);
CREATE INDEX IF NOT EXISTS plugin_users_agent_idx ON plugin_users(agent_id);

CREATE TABLE IF NOT EXISTS main_service_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  admin_email_ciphertext TEXT NOT NULL DEFAULT '',
  admin_password_ciphertext TEXT NOT NULL DEFAULT '',
  credential_version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_users (
  id TEXT PRIMARY KEY,
  main_user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  role TEXT NOT NULL DEFAULT 'user',
  balance_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  observed_at INTEGER NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'fresh',
  last_error TEXT,
  raw_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS remote_users_main_user_uq ON remote_users(main_user_id);
CREATE INDEX IF NOT EXISTS remote_users_status_idx ON remote_users(status);

CREATE TABLE IF NOT EXISTS remote_usage_records (
  id TEXT PRIMARY KEY,
  remote_record_id TEXT NOT NULL,
  main_user_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  tokens INTEGER NOT NULL DEFAULT 0,
  amount_micro INTEGER NOT NULL DEFAULT 0,
  occurred_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  raw_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS remote_usage_records_remote_id_uq ON remote_usage_records(remote_record_id);
CREATE INDEX IF NOT EXISTS remote_usage_records_user_idx ON remote_usage_records(main_user_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_name_uq ON agents(name);

CREATE TABLE IF NOT EXISTS agent_user_assignments (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  main_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  bound_at INTEGER NOT NULL,
  unbound_at INTEGER,
  operator_id TEXT,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_user_assignments_active_uq
  ON agent_user_assignments(main_user_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS agent_user_assignments_agent_idx ON agent_user_assignments(agent_id);
CREATE INDEX IF NOT EXISTS agent_user_assignments_main_user_idx ON agent_user_assignments(main_user_id);

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  balance_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_accounts_agent_uq ON wallet_accounts(agent_id);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  operator_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  related_card_id TEXT,
  related_batch_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_transactions_idempotency_uq ON ledger_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS ledger_transactions_wallet_idx ON ledger_transactions(wallet_id);

CREATE TABLE IF NOT EXISTS card_batches (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  value_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT,
  idempotency_key TEXT,
  request_fingerprint TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS card_batches_agent_idx ON card_batches(agent_id);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  display_mask TEXT NOT NULL,
  value_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  redeemed_at INTEGER,
  redeemed_by TEXT,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cards_code_hash_uq ON cards(code_hash);
CREATE INDEX IF NOT EXISTS cards_batch_idx ON cards(batch_id);
CREATE INDEX IF NOT EXISTS cards_agent_idx ON cards(agent_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS sync_runs_scope_idx ON sync_runs(scope);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  agent_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
`;

export const MIGRATION_ID = '0001_init';
export const MIGRATION_USAGE_MICRO_ID = '0002_usage_amount_micro';
export const MIGRATION_PAID_CARD_ISSUE_ID = '0003_paid_card_issue';
export const MIGRATION_ADMIN_LOGIN_ID = '0004_main_service_admin_login';

// remote_usage_records 是主服务用量的只读缓存，重建后会由下一次同步重新拉取，
// 因此这里直接重建表而不是转换旧值：旧列存的是「分」，小额用量已被舍入成 0，
// 原地乘以 10000 只会把错误数据放大，无法恢复精度。
function migrateUsageAmountToMicro(sqlite: Database.Database): boolean {
  const columns = sqlite
    .prepare(`PRAGMA table_info(remote_usage_records)`)
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'amount_minor')) {
    return false;
  }
  sqlite.exec(`
    DROP TABLE remote_usage_records;
    CREATE TABLE remote_usage_records (
      id TEXT PRIMARY KEY,
      remote_record_id TEXT NOT NULL,
      main_user_id TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      tokens INTEGER NOT NULL DEFAULT 0,
      amount_micro INTEGER NOT NULL DEFAULT 0,
      occurred_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      raw_json TEXT
    );
    CREATE UNIQUE INDEX remote_usage_records_remote_id_uq ON remote_usage_records(remote_record_id);
    CREATE INDEX remote_usage_records_user_idx ON remote_usage_records(main_user_id);
  `);
  return true;
}

function addColumnIfMissing(
  sqlite: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function migratePaidCardIssue(sqlite: Database.Database): void {
  addColumnIfMissing(sqlite, 'ledger_transactions', 'related_batch_id', 'related_batch_id TEXT');
  addColumnIfMissing(sqlite, 'card_batches', 'idempotency_key', 'idempotency_key TEXT');
  addColumnIfMissing(sqlite, 'card_batches', 'request_fingerprint', 'request_fingerprint TEXT');
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS ledger_transactions_batch_idx
      ON ledger_transactions(related_batch_id);
    CREATE UNIQUE INDEX IF NOT EXISTS card_batches_idempotency_uq
      ON card_batches(idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);
}

function migrateMainServiceAdminLogin(sqlite: Database.Database): void {
  addColumnIfMissing(
    sqlite,
    'main_service_settings',
    'admin_email_ciphertext',
    "admin_email_ciphertext TEXT NOT NULL DEFAULT ''",
  );
  addColumnIfMissing(
    sqlite,
    'main_service_settings',
    'admin_password_ciphertext',
    "admin_password_ciphertext TEXT NOT NULL DEFAULT ''",
  );
  addColumnIfMissing(
    sqlite,
    'main_service_settings',
    'credential_version',
    'credential_version INTEGER NOT NULL DEFAULT 1',
  );
}

export function runMigrations(sqlite: Database.Database): { applied: string[] } {
  sqlite.exec(MIGRATION_SQL);
  const applied: string[] = [];

  const hasInit = sqlite
    .prepare('SELECT id FROM schema_migrations WHERE id = ?')
    .get(MIGRATION_ID) as { id: string } | undefined;
  if (!hasInit) {
    sqlite
      .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      .run(MIGRATION_ID, Date.now());
    applied.push(MIGRATION_ID);
  }

  const hasUsageMicro = sqlite
    .prepare('SELECT id FROM schema_migrations WHERE id = ?')
    .get(MIGRATION_USAGE_MICRO_ID) as { id: string } | undefined;
  if (!hasUsageMicro) {
    sqlite.transaction(() => {
      migrateUsageAmountToMicro(sqlite);
      sqlite
        .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(MIGRATION_USAGE_MICRO_ID, Date.now());
    })();
    applied.push(MIGRATION_USAGE_MICRO_ID);
  }

  const hasPaidCardIssue = sqlite
    .prepare('SELECT id FROM schema_migrations WHERE id = ?')
    .get(MIGRATION_PAID_CARD_ISSUE_ID) as { id: string } | undefined;
  if (!hasPaidCardIssue) {
    sqlite.transaction(() => {
      migratePaidCardIssue(sqlite);
      sqlite
        .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(MIGRATION_PAID_CARD_ISSUE_ID, Date.now());
    })();
    applied.push(MIGRATION_PAID_CARD_ISSUE_ID);
  }

  const hasAdminLogin = sqlite
    .prepare('SELECT id FROM schema_migrations WHERE id = ?')
    .get(MIGRATION_ADMIN_LOGIN_ID) as { id: string } | undefined;
  if (!hasAdminLogin) {
    sqlite.transaction(() => {
      migrateMainServiceAdminLogin(sqlite);
      sqlite
        .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(MIGRATION_ADMIN_LOGIN_ID, Date.now());
    })();
    applied.push(MIGRATION_ADMIN_LOGIN_ID);
  }

  return { applied };
}
