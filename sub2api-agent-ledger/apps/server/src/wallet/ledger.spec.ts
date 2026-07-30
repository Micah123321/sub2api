import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate';
import { LedgerError, LedgerService } from './ledger';

function createLedger() {
  const sqlite = new Database(':memory:');
  runMigrations(sqlite);
  return { sqlite, ledger: new LedgerService(sqlite) };
}

describe('ledger', () => {
  it('applies add/subtract/set with non-negative invariant', () => {
    const { ledger } = createLedger();
    const added = ledger.adjust({
      agentId: 'agent-1',
      operation: 'add',
      amountMinor: 1000,
      idempotencyKey: 'k-add-1',
      operatorId: 'admin',
    });
    expect(added.wallet.balanceMinor).toBe(1000);
    expect(added.replayed).toBe(false);

    const subtracted = ledger.adjust({
      agentId: 'agent-1',
      operation: 'subtract',
      amountMinor: 400,
      idempotencyKey: 'k-sub-1',
    });
    expect(subtracted.wallet.balanceMinor).toBe(600);

    const set = ledger.adjust({
      agentId: 'agent-1',
      operation: 'set',
      amountMinor: 800,
      idempotencyKey: 'k-set-1',
    });
    expect(set.wallet.balanceMinor).toBe(800);
    expect(set.transaction.balanceBefore).toBe(600);
    expect(set.transaction.balanceAfter).toBe(800);

    expect(() =>
      ledger.adjust({
        agentId: 'agent-1',
        operation: 'subtract',
        amountMinor: 900,
        idempotencyKey: 'k-sub-fail',
      }),
    ).toThrow(LedgerError);
  });

  it('is idempotent and can recompute balance from transactions', () => {
    const { ledger } = createLedger();
    const first = ledger.adjust({
      agentId: 'agent-2',
      operation: 'add',
      amountMinor: 500,
      idempotencyKey: 'same-key',
    });
    const second = ledger.adjust({
      agentId: 'agent-2',
      operation: 'add',
      amountMinor: 500,
      idempotencyKey: 'same-key',
    });
    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.wallet.balanceMinor).toBe(500);

    ledger.adjust({
      agentId: 'agent-2',
      operation: 'add',
      amountMinor: 250,
      idempotencyKey: 'k2',
    });
    const wallet = ledger.getWalletByAgent('agent-2')!;
    expect(ledger.recomputeBalance(wallet.id)).toBe(750);
  });

  it('rolls back failed negative-balance attempts without partial rows', () => {
    const { sqlite, ledger } = createLedger();
    ledger.adjust({
      agentId: 'agent-3',
      operation: 'add',
      amountMinor: 100,
      idempotencyKey: 'seed',
    });
    expect(() =>
      ledger.adjust({
        agentId: 'agent-3',
        operation: 'subtract',
        amountMinor: 200,
        idempotencyKey: 'will-fail',
      }),
    ).toThrow(LedgerError);

    const exact = sqlite
      .prepare('SELECT COUNT(*) AS c FROM ledger_transactions WHERE idempotency_key = ?')
      .get('will-fail') as { c: number };
    expect(exact.c).toBe(0);
    expect(ledger.getWalletByAgent('agent-3')?.balanceMinor).toBe(100);
  });

  it('rejects idempotency key reuse with different payload', () => {
    const { ledger } = createLedger();
    ledger.adjust({
      agentId: 'agent-4',
      operation: 'add',
      amountMinor: 100,
      idempotencyKey: 'conflict-key',
    });
    expect(() =>
      ledger.adjust({
        agentId: 'agent-4',
        operation: 'add',
        amountMinor: 200,
        idempotencyKey: 'conflict-key',
      }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('returns deterministic transaction pages with totals', () => {
    const { ledger } = createLedger();
    for (let index = 0; index < 3; index += 1) {
      ledger.adjust({
        agentId: 'agent-page',
        operation: 'add',
        amountMinor: 100,
        idempotencyKey: `page-${index}`,
      });
    }
    const wallet = ledger.getWalletByAgent('agent-page')!;
    const first = ledger.listTransactionsPage(wallet.id, { page: 1, pageSize: 2 });
    const second = ledger.listTransactionsPage(wallet.id, { page: 2, pageSize: 2 });
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(3);
  });
});
