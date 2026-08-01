import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';

export const pluginUsers = sqliteTable(
  'plugin_users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['ADMIN', 'AGENT'] }).notNull(),
    agentId: text('agent_id'),
    status: text('status', { enum: ['ACTIVE', 'DISABLED'] }).notNull().default('ACTIVE'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    usernameUnique: uniqueIndex('plugin_users_username_uq').on(table.username),
    agentIdx: index('plugin_users_agent_idx').on(table.agentId),
  }),
);

export const mainServiceSettings = sqliteTable('main_service_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  baseUrl: text('base_url').notNull(),
  apiKeyCiphertext: text('api_key_ciphertext').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  adminEmailCiphertext: text('admin_email_ciphertext').notNull().default(''),
  adminPasswordCiphertext: text('admin_password_ciphertext').notNull().default(''),
  credentialVersion: integer('credential_version').notNull().default(1),
  updatedBy: text('updated_by'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const remoteUsers = sqliteTable(
  'remote_users',
  {
    id: text('id').primaryKey(),
    mainUserId: text('main_user_id').notNull(),
    username: text('username').notNull().default(''),
    email: text('email').notNull().default(''),
    status: text('status').notNull().default('unknown'),
    role: text('role').notNull().default('user'),
    balanceMinor: integer('balance_minor').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
    syncStatus: text('sync_status', {
      enum: ['fresh', 'stale', 'error'],
    })
      .notNull()
      .default('fresh'),
    lastError: text('last_error'),
    rawJson: text('raw_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    mainUserUnique: uniqueIndex('remote_users_main_user_uq').on(table.mainUserId),
    statusIdx: index('remote_users_status_idx').on(table.status),
  }),
);

export const remoteUsageRecords = sqliteTable(
  'remote_usage_records',
  {
    id: text('id').primaryKey(),
    remoteRecordId: text('remote_record_id').notNull(),
    mainUserId: text('main_user_id').notNull(),
    model: text('model').notNull().default(''),
    tokens: integer('tokens').notNull().default(0),
    amountMicro: integer('amount_micro').notNull().default(0),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
    rawJson: text('raw_json'),
  },
  (table) => ({
    remoteRecordUnique: uniqueIndex('remote_usage_records_remote_id_uq').on(
      table.remoteRecordId,
    ),
    mainUserIdx: index('remote_usage_records_user_idx').on(table.mainUserId),
  }),
);

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status', { enum: ['ACTIVE', 'DISABLED'] }).notNull().default('ACTIVE'),
    notes: text('notes').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    nameUnique: uniqueIndex('agents_name_uq').on(table.name),
  }),
);

export const agentUserAssignments = sqliteTable(
  'agent_user_assignments',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    mainUserId: text('main_user_id').notNull(),
    status: text('status', { enum: ['ACTIVE', 'UNBOUND'] }).notNull().default('ACTIVE'),
    boundAt: integer('bound_at', { mode: 'timestamp_ms' }).notNull(),
    unboundAt: integer('unbound_at', { mode: 'timestamp_ms' }),
    operatorId: text('operator_id'),
    notes: text('notes').notNull().default(''),
  },
  (table) => ({
    // SQLite 部分唯一索引在 migrate SQL 中创建；此处保留查询索引
    agentIdx: index('agent_user_assignments_agent_idx').on(table.agentId),
    mainUserIdx: index('agent_user_assignments_main_user_idx').on(table.mainUserId),
  }),
);

export const walletAccounts = sqliteTable(
  'wallet_accounts',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    balanceMinor: integer('balance_minor').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    version: integer('version').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    agentUnique: uniqueIndex('wallet_accounts_agent_uq').on(table.agentId),
  }),
);

export const ledgerTransactions = sqliteTable(
  'ledger_transactions',
  {
    id: text('id').primaryKey(),
    walletId: text('wallet_id').notNull(),
    type: text('type', {
      enum: ['ADJUST_ADD', 'ADJUST_SUBTRACT', 'ADJUST_SET', 'CARD_REDEEM', 'CARD_ISSUE'],
    }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    balanceBefore: integer('balance_before').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    operatorId: text('operator_id'),
    notes: text('notes').notNull().default(''),
    relatedCardId: text('related_card_id'),
    relatedBatchId: text('related_batch_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex('ledger_transactions_idempotency_uq').on(
      table.idempotencyKey,
    ),
    walletIdx: index('ledger_transactions_wallet_idx').on(table.walletId),
    batchIdx: index('ledger_transactions_batch_idx').on(table.relatedBatchId),
  }),
);

export const cardBatches = sqliteTable(
  'card_batches',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    count: integer('count').notNull(),
    valueMinor: integer('value_minor').notNull(),
    status: text('status', { enum: ['ACTIVE', 'CLOSED'] }).notNull().default('ACTIVE'),
    createdBy: text('created_by'),
    idempotencyKey: text('idempotency_key'),
    requestFingerprint: text('request_fingerprint'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    agentIdx: index('card_batches_agent_idx').on(table.agentId),
    idempotencyUnique: uniqueIndex('card_batches_idempotency_uq').on(
      table.idempotencyKey,
    ),
  }),
);

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    agentId: text('agent_id').notNull(),
    codeHash: text('code_hash').notNull(),
    displayMask: text('display_mask').notNull(),
    valueMinor: integer('value_minor').notNull(),
    status: text('status', {
      enum: ['ACTIVE', 'REDEEMED', 'REVOKED'],
    })
      .notNull()
      .default('ACTIVE'),
    redeemedAt: integer('redeemed_at', { mode: 'timestamp_ms' }),
    redeemedBy: text('redeemed_by'),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    codeHashUnique: uniqueIndex('cards_code_hash_uq').on(table.codeHash),
    batchIdx: index('cards_batch_idx').on(table.batchId),
    agentIdx: index('cards_agent_idx').on(table.agentId),
  }),
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    payloadJson: text('payload_json').notNull().default('{}'),
    requestId: text('request_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    actionIdx: index('audit_logs_action_idx').on(table.action),
    createdIdx: index('audit_logs_created_idx').on(table.createdAt),
  }),
);

export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    status: text('status', {
      enum: ['running', 'success', 'error'],
    }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    metaJson: text('meta_json').notNull().default('{}'),
  },
  (table) => ({
    scopeIdx: index('sync_runs_scope_idx').on(table.scope),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ['ADMIN', 'AGENT'] }).notNull(),
    agentId: text('agent_id'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    userIdx: index('sessions_user_idx').on(table.userId),
    expiresIdx: index('sessions_expires_idx').on(table.expiresAt),
  }),
);
