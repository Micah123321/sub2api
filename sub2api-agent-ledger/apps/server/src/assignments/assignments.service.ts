import type Database from 'better-sqlite3';
import { createId } from '../common/ids';

export interface AssignmentRecord {
  id: string;
  agentId: string;
  mainUserId: string;
  status: 'ACTIVE' | 'UNBOUND';
  boundAt: number;
  unboundAt: number | null;
  operatorId: string | null;
  notes: string;
}

export interface BatchBindItemResult {
  mainUserId: string;
  status: 'bound' | 'already_bound' | 'transferred' | 'conflict' | 'failed';
  assignmentId?: string;
  message: string;
}

export class AssignmentsService {
  constructor(private readonly sqlite: Database.Database) {}

  listActive(agentId?: string): AssignmentRecord[] {
    if (agentId) {
      return (
        this.sqlite
          .prepare(
            `SELECT * FROM agent_user_assignments
             WHERE agent_id = ? AND status = 'ACTIVE'
             ORDER BY bound_at DESC`,
          )
          .all(agentId) as Array<Record<string, unknown>>
      ).map(mapAssignment);
    }
    return (
      this.sqlite
        .prepare(
          `SELECT * FROM agent_user_assignments
           WHERE status = 'ACTIVE'
           ORDER BY bound_at DESC`,
        )
        .all() as Array<Record<string, unknown>>
    ).map(mapAssignment);
  }

  history(limit = 100): AssignmentRecord[] {
    return (
      this.sqlite
        .prepare(
          `SELECT * FROM agent_user_assignments
           ORDER BY bound_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<Record<string, unknown>>
    ).map(mapAssignment);
  }

  batchBind(input: {
    agentId: string;
    mainUserIds: string[];
    operatorId?: string | null;
    transfer?: boolean;
    notes?: string;
  }): BatchBindItemResult[] {
    const results: BatchBindItemResult[] = [];
    const transfer = Boolean(input.transfer);
    const now = Date.now();

    const run = this.sqlite.transaction(() => {
      for (const rawId of input.mainUserIds) {
        const mainUserId = String(rawId).trim();
        if (!mainUserId) {
          results.push({
            mainUserId: rawId,
            status: 'failed',
            message: '用户 ID 为空',
          });
          continue;
        }

        const active = this.sqlite
          .prepare(
            `SELECT * FROM agent_user_assignments
             WHERE main_user_id = ? AND status = 'ACTIVE'`,
          )
          .get(mainUserId) as Record<string, unknown> | undefined;

        if (active) {
          if (String(active.agent_id) === input.agentId) {
            results.push({
              mainUserId,
              status: 'already_bound',
              assignmentId: String(active.id),
              message: '已绑定到当前代理商',
            });
            continue;
          }
          if (!transfer) {
            results.push({
              mainUserId,
              status: 'conflict',
              assignmentId: String(active.id),
              message: `已绑定到其他代理商 ${String(active.agent_id)}，需显式 transfer`,
            });
            continue;
          }

          this.sqlite
            .prepare(
              `UPDATE agent_user_assignments
               SET status = 'UNBOUND', unbound_at = ?, notes = ?
               WHERE id = ?`,
            )
            .run(now, `transferred to ${input.agentId}`, String(active.id));
        }

        const id = createId('asg');
        this.sqlite
          .prepare(
            `INSERT INTO agent_user_assignments
             (id, agent_id, main_user_id, status, bound_at, unbound_at, operator_id, notes)
             VALUES (?, ?, ?, 'ACTIVE', ?, NULL, ?, ?)`,
          )
          .run(
            id,
            input.agentId,
            mainUserId,
            now,
            input.operatorId ?? null,
            input.notes ?? (active ? 'transfer bind' : ''),
          );

        results.push({
          mainUserId,
          status: active ? 'transferred' : 'bound',
          assignmentId: id,
          message: active ? '已转移并绑定' : '绑定成功',
        });
      }
    });

    run();
    return results;
  }

  unbind(assignmentId: string, operatorId?: string | null): AssignmentRecord {
    const row = this.sqlite
      .prepare('SELECT * FROM agent_user_assignments WHERE id = ?')
      .get(assignmentId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error('绑定记录不存在');
    }
    if (row.status !== 'ACTIVE') {
      return mapAssignment(row);
    }
    this.sqlite
      .prepare(
        `UPDATE agent_user_assignments
         SET status = 'UNBOUND', unbound_at = ?, operator_id = COALESCE(?, operator_id)
         WHERE id = ?`,
      )
      .run(Date.now(), operatorId ?? null, assignmentId);
    return mapAssignment(
      this.sqlite
        .prepare('SELECT * FROM agent_user_assignments WHERE id = ?')
        .get(assignmentId) as Record<string, unknown>,
    );
  }
}

function mapAssignment(row: Record<string, unknown>): AssignmentRecord {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    mainUserId: String(row.main_user_id),
    status: row.status as 'ACTIVE' | 'UNBOUND',
    boundAt: Number(row.bound_at),
    unboundAt: row.unbound_at == null ? null : Number(row.unbound_at),
    operatorId: (row.operator_id as string | null) ?? null,
    notes: String(row.notes ?? ''),
  };
}
