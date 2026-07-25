#!/bin/sh
set -eu

# Ensure data directory exists (volume may mount empty)
mkdir -p "${PLUGIN_DATA_DIR:-/app/data}"

# Run SQLite migrations via compiled modules (no tsx required at runtime)
node <<'NODE'
const { openDatabase } = require('./dist/server/db/client');
const { runMigrations } = require('./dist/server/db/migrate');

const { sqlite, filename } = openDatabase();
try {
  const result = runMigrations(sqlite);
  console.log(
    JSON.stringify({
      ok: true,
      stage: 'migrate',
      filename,
      applied: result.applied,
    }),
  );
} finally {
  sqlite.close();
}
NODE

# Compatibility: if first arg is a flag, prepend default command
if [ "${1#-}" != "$1" ]; then
  set -- node dist/server/main.js "$@"
fi

exec "$@"
