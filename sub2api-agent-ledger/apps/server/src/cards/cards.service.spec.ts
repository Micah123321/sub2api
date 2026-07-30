import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate';
import { LedgerService } from '../wallet/ledger';
import { CardsService } from './cards.service';

describe('CardsService pagination', () => {
  it('pages card batches and cards independently', () => {
    const sqlite = new Database(':memory:');
    runMigrations(sqlite);
    const ledger = new LedgerService(sqlite);
    const cards = new CardsService(sqlite, ledger);
    ledger.adjust({ agentId: 'agent-1', operation: 'add', amountMinor: 1_000, idempotencyKey: 'seed' });

    for (let index = 0; index < 3; index += 1) {
      cards.issueBatch({ agentId: 'agent-1', count: 1, valueMinor: 100, idempotencyKey: `batch-${index}` });
    }

    expect(cards.listBatchesPage('agent-1', { page: 1, pageSize: 2 })).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(cards.listBatchesPage('agent-1', { page: 2, pageSize: 2 }).items).toHaveLength(1);
    expect(cards.listCardsPage({ agentId: 'agent-1' }, { page: 2, pageSize: 2 }).items).toHaveLength(1);
  });
});
