import type Database from 'better-sqlite3';
import { createId } from '../common/ids';
import { LedgerService } from '../wallet/ledger';
import { UserRepository } from '../auth/user.repository';
import type { AuthUser } from '../auth/auth.types';

export interface AgentRecord {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentSummary extends AgentRecord {
  walletBalanceMinor: number;
  activeBindings: number;
  loginUsername: string | null;
}

export class AgentsService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly ledger: LedgerService,
    private readonly users: UserRepository,
  ) {}

  list(): AgentSummary[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM agents ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toSummary(this.map(row)));
  }

  get(id: string): AgentSummary | null {
    const row = this.sqlite
      .prepare('SELECT * FROM agents WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.toSummary(this.map(row)) : null;
  }

  async create(input: {
    name: string;
    notes?: string;
    username: string;
    password: string;
  }): Promise<{ agent: AgentSummary; user: AuthUser }> {
    const name = input.name.trim();
    const username = input.username.trim();
    if (!name || !username || !input.password) {
      throw new Error('name/username/password 必填');
    }

    const existing = this.sqlite
      .prepare('SELECT id FROM agents WHERE name = ?')
      .get(name);
    if (existing) {
      throw new Error('代理商名称已存在');
    }
    if (this.users.findByUsername(username)) {
      throw new Error('登录用户名已存在');
    }

    const now = Date.now();
    const agentId = createId('agt');
    const run = this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO agents (id, name, status, notes, created_at, updated_at)
           VALUES (?, ?, 'ACTIVE', ?, ?, ?)`,
        )
        .run(agentId, name, input.notes ?? '', now, now);
    });
    run();
    this.ledger.ensureWallet(agentId);

    const user = await this.users.createUser({
      username,
      password: input.password,
      role: 'AGENT',
      agentId,
      status: 'ACTIVE',
    });

    return { agent: this.get(agentId)!, user };
  }

  setStatus(id: string, status: 'ACTIVE' | 'DISABLED'): AgentSummary {
    const agent = this.get(id);
    if (!agent) {
      throw new Error('代理商不存在');
    }
    this.sqlite
      .prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id);

    const loginUsers = this.sqlite
      .prepare('SELECT id FROM plugin_users WHERE agent_id = ?')
      .all(id) as Array<{ id: string }>;
    for (const user of loginUsers) {
      this.users.setStatus(user.id, status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED');
    }
    return this.get(id)!;
  }

  private toSummary(agent: AgentRecord): AgentSummary {
    const wallet = this.ledger.ensureWallet(agent.id);
    const binding = this.sqlite
      .prepare(
        `SELECT COUNT(*) as c FROM agent_user_assignments
         WHERE agent_id = ? AND status = 'ACTIVE'`,
      )
      .get(agent.id) as { c: number };
    const login = this.sqlite
      .prepare(
        `SELECT username FROM plugin_users
         WHERE agent_id = ? AND role = 'AGENT'
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(agent.id) as { username: string } | undefined;
    return {
      ...agent,
      walletBalanceMinor: wallet.balanceMinor,
      activeBindings: binding.c,
      loginUsername: login?.username ?? null,
    };
  }

  private map(row: Record<string, unknown>): AgentRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      status: row.status as 'ACTIVE' | 'DISABLED',
      notes: String(row.notes ?? ''),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
