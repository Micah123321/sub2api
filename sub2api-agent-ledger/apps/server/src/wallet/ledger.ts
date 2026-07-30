import type Database from 'better-sqlite3';
import {
  addMinor,
  assertIntegerMinor,
  assertNonNegativeBalance,
  computeDeltaForSet,
  MoneyError,
} from '../common/money';
import { createId } from '../common/ids';

export type LedgerTxType =
  | 'ADJUST_ADD'
  | 'ADJUST_SUBTRACT'
  | 'ADJUST_SET'
  | 'CARD_REDEEM'
  | 'CARD_ISSUE';

export type AdjustOperation = 'add' | 'subtract' | 'set';

export interface WalletAccount {
  id: string;
  agentId: string;
  balanceMinor: number;
  currency: string;
  version: number;
}

export interface LedgerTransaction {
  id: string;
  walletId: string;
  type: LedgerTxType;
  amountMinor: number;
  balanceBefore: number;
  balanceAfter: number;
  idempotencyKey: string;
  operatorId: string | null;
  notes: string;
  relatedCardId: string | null;
  relatedBatchId: string | null;
  createdAt: number;
}

export interface AdjustWalletInput {
  agentId: string;
  operation: AdjustOperation;
  amountMinor: number;
  idempotencyKey: string;
  operatorId?: string | null;
  notes?: string;
  relatedCardId?: string | null;
  relatedBatchId?: string | null;
  currency?: string;
}

export interface AdjustWalletResult {
  wallet: WalletAccount;
  transaction: LedgerTransaction;
  replayed: boolean;
}

export class LedgerError extends Error {
  constructor(
    public readonly code:
      | 'WALLET_NOT_FOUND'
      | 'IDEMPOTENCY_CONFLICT'
      | 'NEGATIVE_BALANCE'
      | 'INVALID_AMOUNT'
      | 'INVALID_OPERATION',
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

interface WalletRow {
  id: string;
  agent_id: string;
  balance_minor: number;
  currency: string;
  version: number;
}

interface TxRow {
  id: string;
  wallet_id: string;
  type: LedgerTxType;
  amount_minor: number;
  balance_before: number;
  balance_after: number;
  idempotency_key: string;
  operator_id: string | null;
  notes: string;
  related_card_id: string | null;
  related_batch_id: string | null;
  created_at: number;
}

export class LedgerService {
  constructor(private readonly sqlite: Database.Database) {}

  ensureWallet(agentId: string, currency = 'USD'): WalletAccount {
    const existing = this.getWalletByAgent(agentId);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const id = createId('wal');
    this.sqlite
      .prepare(
        `INSERT INTO wallet_accounts
         (id, agent_id, balance_minor, currency, version, created_at, updated_at)
         VALUES (?, ?, 0, ?, 0, ?, ?)`,
      )
      .run(id, agentId, currency, now, now);
    return {
      id,
      agentId,
      balanceMinor: 0,
      currency,
      version: 0,
    };
  }

  getWalletByAgent(agentId: string): WalletAccount | null {
    const row = this.sqlite
      .prepare('SELECT * FROM wallet_accounts WHERE agent_id = ?')
      .get(agentId) as WalletRow | undefined;
    return row ? mapWallet(row) : null;
  }

  listTransactions(walletId: string, limit = 50): LedgerTransaction[] {
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM ledger_transactions
         WHERE wallet_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(walletId, limit) as TxRow[];
    return rows.map(mapTx);
  }

  recomputeBalance(walletId: string): number {
    const row = this.sqlite
      .prepare(
        `SELECT COALESCE(SUM(
           CASE
             WHEN type IN ('ADJUST_ADD', 'CARD_REDEEM') THEN amount_minor
             WHEN type IN ('ADJUST_SUBTRACT', 'CARD_ISSUE') THEN -amount_minor
             WHEN type = 'ADJUST_SET' THEN 0
             ELSE 0
           END
         ), 0) AS total
         FROM ledger_transactions
         WHERE wallet_id = ? AND type != 'ADJUST_SET'`,
      )
      .get(walletId) as { total: number };

    // ADJUST_SET is absolute; recompute by replaying in order.
    const txs = this.sqlite
      .prepare(
        `SELECT type, amount_minor, balance_after
         FROM ledger_transactions
         WHERE wallet_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(walletId) as Array<{ type: LedgerTxType; amount_minor: number; balance_after: number }>;

    let balance = 0;
    for (const tx of txs) {
      if (tx.type === 'ADJUST_SET') {
        balance = tx.amount_minor;
      } else if (tx.type === 'ADJUST_ADD' || tx.type === 'CARD_REDEEM') {
        balance = addMinor(balance, tx.amount_minor);
      } else if (tx.type === 'ADJUST_SUBTRACT' || tx.type === 'CARD_ISSUE') {
        balance = addMinor(balance, -tx.amount_minor);
      }
    }

    // keep unused row total for potential future diagnostics
    void row;
    return balance;
  }

  adjust(input: AdjustWalletInput): AdjustWalletResult {
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new LedgerError('INVALID_OPERATION', 'idempotencyKey 必填');
    }

    const existing = this.sqlite
      .prepare('SELECT * FROM ledger_transactions WHERE idempotency_key = ?')
      .get(idempotencyKey) as TxRow | undefined;
    if (existing) {
      const wallet = this.getWalletById(existing.wallet_id);
      if (!wallet) {
        throw new LedgerError('WALLET_NOT_FOUND', '幂等交易对应钱包不存在');
      }
      const expectedType =
        input.operation === 'add'
          ? input.relatedCardId
            ? 'CARD_REDEEM'
            : 'ADJUST_ADD'
          : input.operation === 'subtract'
            ? input.relatedBatchId
              ? 'CARD_ISSUE'
              : 'ADJUST_SUBTRACT'
            : 'ADJUST_SET';
      const expectedAmount =
        expectedType === 'ADJUST_SET' ? input.amountMinor : Math.abs(input.amountMinor);
      if (
        wallet.agentId !== input.agentId ||
        existing.type !== expectedType ||
        existing.amount_minor !== expectedAmount ||
        (existing.related_card_id || null) !== (input.relatedCardId ?? null) ||
        (existing.related_batch_id || null) !== (input.relatedBatchId ?? null)
      ) {
        throw new LedgerError(
          'IDEMPOTENCY_CONFLICT',
          '幂等键已存在但请求内容与原交易不一致',
        );
      }
      return {
        wallet,
        transaction: mapTx(existing),
        replayed: true,
      };
    }

    try {
      assertIntegerMinor(input.amountMinor, 'amountMinor');
    } catch (error) {
      if (error instanceof MoneyError) {
        throw new LedgerError('INVALID_AMOUNT', error.message);
      }
      throw error;
    }

    if (input.operation !== 'set' && input.amountMinor <= 0) {
      throw new LedgerError('INVALID_AMOUNT', '增减金额必须为正整数最小单位');
    }
    if (input.operation === 'set' && input.amountMinor < 0) {
      throw new LedgerError('INVALID_AMOUNT', '目标余额不能为负');
    }

    const run = this.sqlite.transaction(() => {
      const wallet = this.ensureWallet(input.agentId, input.currency ?? 'USD');
      const locked = this.sqlite
        .prepare('SELECT * FROM wallet_accounts WHERE id = ?')
        .get(wallet.id) as WalletRow;
      const balanceBefore = locked.balance_minor;

      let delta = 0;
      let type: LedgerTxType;
      if (input.operation === 'add') {
        delta = input.amountMinor;
        type = input.relatedCardId ? 'CARD_REDEEM' : 'ADJUST_ADD';
      } else if (input.operation === 'subtract') {
        delta = -input.amountMinor;
        type = input.relatedBatchId ? 'CARD_ISSUE' : 'ADJUST_SUBTRACT';
      } else if (input.operation === 'set') {
        delta = computeDeltaForSet(balanceBefore, input.amountMinor);
        type = 'ADJUST_SET';
      } else {
        throw new LedgerError('INVALID_OPERATION', '未知余额操作');
      }

      let balanceAfter: number;
      try {
        balanceAfter =
          type === 'ADJUST_SET'
            ? assertNonNegativeBalance(input.amountMinor)
            : assertNonNegativeBalance(addMinor(balanceBefore, delta));
      } catch (error) {
        if (error instanceof MoneyError && error.code === 'NEGATIVE_BALANCE') {
          throw new LedgerError('NEGATIVE_BALANCE', '余额不足，禁止产生负余额');
        }
        throw error;
      }

      const amountRecorded =
        type === 'ADJUST_SET' ? input.amountMinor : Math.abs(input.amountMinor);
      const now = Date.now();
      const txId = createId('ltx');

      this.sqlite
        .prepare(
          `INSERT INTO ledger_transactions
           (id, wallet_id, type, amount_minor, balance_before, balance_after,
            idempotency_key, operator_id, notes, related_card_id, related_batch_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          txId,
          locked.id,
          type,
          amountRecorded,
          balanceBefore,
          balanceAfter,
          idempotencyKey,
          input.operatorId ?? null,
          input.notes ?? '',
          input.relatedCardId ?? null,
          input.relatedBatchId ?? null,
          now,
        );

      this.sqlite
        .prepare(
          `UPDATE wallet_accounts
           SET balance_minor = ?, version = version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(balanceAfter, now, locked.id);

      const updated = this.getWalletById(locked.id)!;
      const transaction = this.getTransaction(txId)!;
      return { wallet: updated, transaction, replayed: false };
    });

    return run();
  }

  private getWalletById(id: string): WalletAccount | null {
    const row = this.sqlite
      .prepare('SELECT * FROM wallet_accounts WHERE id = ?')
      .get(id) as WalletRow | undefined;
    return row ? mapWallet(row) : null;
  }

  private getTransaction(id: string): LedgerTransaction | null {
    const row = this.sqlite
      .prepare('SELECT * FROM ledger_transactions WHERE id = ?')
      .get(id) as TxRow | undefined;
    return row ? mapTx(row) : null;
  }
}

function mapWallet(row: WalletRow): WalletAccount {
  return {
    id: row.id,
    agentId: row.agent_id,
    balanceMinor: row.balance_minor,
    currency: row.currency,
    version: row.version,
  };
}

function mapTx(row: TxRow): LedgerTransaction {
  return {
    id: row.id,
    walletId: row.wallet_id,
    type: row.type,
    amountMinor: row.amount_minor,
    balanceBefore: row.balance_before,
    balanceAfter: row.balance_after,
    idempotencyKey: row.idempotency_key,
    operatorId: row.operator_id,
    notes: row.notes,
    relatedCardId: row.related_card_id,
    relatedBatchId: row.related_batch_id,
    createdAt: row.created_at,
  };
}
