import { createDb } from './db.js';
import { createApp } from './app.js';
const db = createDb();
const app = createApp(db, { origins: (process.env.ALLOWED_ORIGINS ?? 'http://tauri.localhost,https://tauri.localhost,tauri://localhost').split(',').map(s => s.trim()).filter(Boolean) });
await db.query('SELECT name FROM schema_migrations LIMIT 1');
const port = Number(process.env.PORT ?? 3000);
app.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`P2P Music API listening on ${port}`));
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 15000); deadline.unref();
  app.close(async () => { await db.close(); clearTimeout(deadline); });
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
