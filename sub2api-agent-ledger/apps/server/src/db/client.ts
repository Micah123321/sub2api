import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface OpenDatabaseOptions {
  filename?: string;
  readonly?: boolean;
}

export function resolveDataDir(envDir?: string): string {
  return resolve(process.cwd(), envDir || process.env.PLUGIN_DATA_DIR || './data');
}

export function resolveSqlitePath(envDir?: string): string {
  return resolve(resolveDataDir(envDir), 'agent-ledger.sqlite');
}

export function openDatabase(options: OpenDatabaseOptions = {}): {
  sqlite: Database.Database;
  db: AppDatabase;
  filename: string;
} {
  const filename = options.filename ?? resolveSqlitePath();
  mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new Database(
    filename,
    options.readonly ? { readonly: true } : undefined,
  );
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db, filename };
}

export function withTransaction<T>(
  sqlite: Database.Database,
  fn: () => T,
): T {
  const tx = sqlite.transaction(fn);
  return tx();
}
