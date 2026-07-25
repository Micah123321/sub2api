import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createId } from '../common/ids';
import { displayCardMask, hashCardCode } from '../common/crypto';
import { assertIntegerMinor } from '../common/money';
import { LedgerService } from '../wallet/ledger';

export interface CardBatch {
  id: string;
  agentId: string;
  count: number;
  valueMinor: number;
  status: 'ACTIVE' | 'CLOSED';
  createdBy: string | null;
  createdAt: number;
}

export interface CardRecord {
  id: string;
  batchId: string;
  agentId: string;
  displayMask: string;
  valueMinor: number;
  status: 'ACTIVE' | 'REDEEMED' | 'REVOKED';
  redeemedAt: number | null;
  redeemedBy: string | null;
  revokedAt: number | null;
  createdAt: number;
}

export interface GeneratedCard extends CardRecord {
  code: string;
}

export class CardsService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly ledger: LedgerService,
  ) {}

  createBatch(input: {
    agentId: string;
    count: number;
    valueMinor: number;
    createdBy?: string | null;
  }): { batch: CardBatch; cards: GeneratedCard[] } {
    if (!Number.isInteger(input.count) || input.count <= 0 || input.count > 500) {
      throw new Error('count 必须是 1-500 的整数');
    }
    assertIntegerMinor(input.valueMinor, 'valueMinor');
    if (input.valueMinor <= 0) {
      throw new Error('面值必须为正整数最小单位');
    }

    const batchId = createId('cbatch');
    const now = Date.now();
    const cards: GeneratedCard[] = [];

    const run = this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO card_batches
           (id, agent_id, count, value_minor, status, created_by, created_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .run(
          batchId,
          input.agentId,
          input.count,
          input.valueMinor,
          input.createdBy ?? null,
          now,
        );

      const insert = this.sqlite.prepare(
        `INSERT INTO cards
         (id, batch_id, agent_id, code_hash, display_mask, value_minor, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      );

      for (let i = 0; i < input.count; i += 1) {
        const code = generateCardCode();
        const id = createId('card');
        insert.run(
          id,
          batchId,
          input.agentId,
          hashCardCode(code),
          displayCardMask(code),
          input.valueMinor,
          now,
        );
        cards.push({
          id,
          batchId,
          agentId: input.agentId,
          displayMask: displayCardMask(code),
          valueMinor: input.valueMinor,
          status: 'ACTIVE',
          redeemedAt: null,
          redeemedBy: null,
          revokedAt: null,
          createdAt: now,
          code,
        });
      }
    });
    run();

    return {
      batch: this.getBatch(batchId)!,
      cards,
    };
  }

  listBatches(agentId?: string): CardBatch[] {
    const rows = agentId
      ? (this.sqlite
          .prepare('SELECT * FROM card_batches WHERE agent_id = ? ORDER BY created_at DESC')
          .all(agentId) as Array<Record<string, unknown>>)
      : (this.sqlite
          .prepare('SELECT * FROM card_batches ORDER BY created_at DESC')
          .all() as Array<Record<string, unknown>>);
    return rows.map(mapBatch);
  }

  listCards(filter: { agentId?: string; batchId?: string; status?: string } = {}): CardRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.agentId) {
      clauses.push('agent_id = ?');
      params.push(filter.agentId);
    }
    if (filter.batchId) {
      clauses.push('batch_id = ?');
      params.push(filter.batchId);
    }
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.sqlite
      .prepare(`SELECT * FROM cards ${where} ORDER BY created_at DESC LIMIT 500`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map(mapCard);
  }

  revoke(cardId: string): CardRecord {
    const card = this.getCard(cardId);
    if (!card) {
      throw new Error('卡密不存在');
    }
    if (card.status !== 'ACTIVE') {
      return card;
    }
    this.sqlite
      .prepare(
        `UPDATE cards SET status = 'REVOKED', revoked_at = ? WHERE id = ?`,
      )
      .run(Date.now(), cardId);
    return this.getCard(cardId)!;
  }

  redeem(input: {
    code: string;
    agentId: string;
    operatorId?: string | null;
    idempotencyKey?: string;
  }) {
    const code = input.code.trim();
    if (!code) {
      throw new Error('卡密不能为空');
    }
    const codeHash = hashCardCode(code);
    const row = this.sqlite
      .prepare('SELECT * FROM cards WHERE code_hash = ?')
      .get(codeHash) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error('卡密不存在');
    }
    const card = mapCard(row);
    if (card.agentId !== input.agentId) {
      throw new Error('卡密不属于当前代理商');
    }
    if (card.status === 'REDEEMED') {
      return {
        replayed: true,
        card,
        wallet: this.ledger.getWalletByAgent(input.agentId),
      };
    }
    if (card.status !== 'ACTIVE') {
      throw new Error('卡密不可核销');
    }

    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      `card-redeem:${card.id}`;

    const run = this.sqlite.transaction(() => {
      const locked = this.sqlite
        .prepare('SELECT * FROM cards WHERE id = ?')
        .get(card.id) as Record<string, unknown>;
      if (locked.status !== 'ACTIVE') {
        throw new Error('卡密状态已变更');
      }

      const result = this.ledger.adjust({
        agentId: input.agentId,
        operation: 'add',
        amountMinor: card.valueMinor,
        idempotencyKey,
        operatorId: input.operatorId,
        notes: `redeem card ${card.displayMask}`,
        relatedCardId: card.id,
      });

      this.sqlite
        .prepare(
          `UPDATE cards
           SET status = 'REDEEMED', redeemed_at = ?, redeemed_by = ?
           WHERE id = ?`,
        )
        .run(Date.now(), input.operatorId ?? null, card.id);

      return {
        replayed: result.replayed,
        card: this.getCard(card.id)!,
        wallet: result.wallet,
        transaction: result.transaction,
      };
    });

    return run();
  }

  getBatch(id: string): CardBatch | null {
    const row = this.sqlite
      .prepare('SELECT * FROM card_batches WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapBatch(row) : null;
  }

  getCard(id: string): CardRecord | null {
    const row = this.sqlite
      .prepare('SELECT * FROM cards WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapCard(row) : null;
  }
}

function generateCardCode(): string {
  // 24 chars base32-ish from random bytes, collision retries happen at unique index layer
  return randomBytes(18).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 24);
}

function mapBatch(row: Record<string, unknown>): CardBatch {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    count: Number(row.count),
    valueMinor: Number(row.value_minor),
    status: row.status as 'ACTIVE' | 'CLOSED',
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: Number(row.created_at),
  };
}

function mapCard(row: Record<string, unknown>): CardRecord {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    agentId: String(row.agent_id),
    displayMask: String(row.display_mask),
    valueMinor: Number(row.value_minor),
    status: row.status as 'ACTIVE' | 'REDEEMED' | 'REVOKED',
    redeemedAt: row.redeemed_at == null ? null : Number(row.redeemed_at),
    redeemedBy: (row.redeemed_by as string | null) ?? null,
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
    createdAt: Number(row.created_at),
  };
}

// keep createHash import used for potential future salt strategies
void createHash;
