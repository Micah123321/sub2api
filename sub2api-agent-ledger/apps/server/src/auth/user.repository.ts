import type Database from 'better-sqlite3';
import { createId } from '../common/ids';
import { hashPassword } from './password';
import type { AuthRole, AuthUser, UserStatus } from './auth.types';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: AuthRole;
  agent_id: string | null;
  status: UserStatus;
}

export class UserRepository {
  constructor(private readonly sqlite: Database.Database) {}

  findByUsername(username: string): AuthUser | null {
    const row = this.sqlite
      .prepare('SELECT * FROM plugin_users WHERE username = ?')
      .get(username) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  findById(id: string): AuthUser | null {
    const row = this.sqlite
      .prepare('SELECT * FROM plugin_users WHERE id = ?')
      .get(id) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  async createUser(input: {
    username: string;
    password: string;
    role: AuthRole;
    agentId?: string | null;
    status?: UserStatus;
  }): Promise<AuthUser> {
    const id = createId('usr');
    const now = Date.now();
    const passwordHash = await hashPassword(input.password);
    this.sqlite
      .prepare(
        `INSERT INTO plugin_users
         (id, username, password_hash, role, agent_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.username,
        passwordHash,
        input.role,
        input.agentId ?? null,
        input.status ?? 'ACTIVE',
        now,
        now,
      );
    return this.findById(id)!;
  }

  listByRole(role: AuthRole): AuthUser[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM plugin_users WHERE role = ? ORDER BY username ASC')
      .all(role) as UserRow[];
    return rows.map(mapUser);
  }

  setStatus(id: string, status: UserStatus): void {
    this.sqlite
      .prepare('UPDATE plugin_users SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id);
  }

  async updateAgentLogin(userId: string, input: { username?: string; password?: string }): Promise<AuthUser> {
    const user = this.findById(userId);
    if (!user || user.role !== 'AGENT') throw new Error('代理登录账号不存在');
    const username = input.username?.trim();
    if (username && username !== user.username) {
      if (this.findByUsername(username)) throw new Error('登录用户名已存在');
      this.sqlite.prepare('UPDATE plugin_users SET username = ?, updated_at = ? WHERE id = ?').run(username, Date.now(), userId);
    }
    if (input.password) {
      this.sqlite.prepare('UPDATE plugin_users SET password_hash = ?, updated_at = ? WHERE id = ?').run(await hashPassword(input.password), Date.now(), userId);
    }
    return this.findById(userId)!;
  }

  findAgentLogin(agentId: string): AuthUser | null {
    const row = this.sqlite.prepare("SELECT * FROM plugin_users WHERE agent_id = ? AND role = 'AGENT' ORDER BY created_at ASC LIMIT 1").get(agentId) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    agentId: row.agent_id,
    status: row.status,
  };
}
