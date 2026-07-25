import { openDatabase } from '../apps/server/src/db/client';
import { runMigrations } from '../apps/server/src/db/migrate';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const dataDir = resolve(process.cwd(), process.env.PLUGIN_DATA_DIR || './data');
  mkdirSync(dataDir, { recursive: true });
  const { sqlite, filename } = openDatabase();
  try {
    const result = runMigrations(sqlite);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          filename,
          applied: result.applied,
        },
        null,
        2,
      ),
    );
  } finally {
    sqlite.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
