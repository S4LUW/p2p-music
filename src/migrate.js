import { readdir, readFile } from 'node:fs/promises';
export async function migrate(db) {
  await db.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(707203001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const folder = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(folder)).filter(n => n.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rows.length) continue;
      // SQL files are trusted, version-controlled migration source, never request input.
      await client.query(await readFile(new URL(name, folder), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
  });
}
