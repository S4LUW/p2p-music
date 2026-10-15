import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { migrate } from '../src/migrate.js';
import { createAccount, digest } from '../src/auth.js';
import { createApp } from '../src/app.js';

let db, app, url, token, accountId, otherToken, cleanup;
const password = 'test-only-password-987';
const pid = randomUUID();
const entry = () => ({ id: randomUUID(), file: { id: 'a'.repeat(64), name: 'Faixa.mp3', size: 1000 } });
const op = (type, baseVersion, extra = {}) => ({ operationId: randomUUID(), playlistId: pid, type, baseVersion, ...extra });
async function request(path, body, auth = token, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(url + path, { method, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
const send = operations => request('/v1/sync', { operations });
before(async () => {
  if (process.env.TEST_DATABASE_URL) {
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 5 });
    db = { query: (s, p) => pool.query(s, p), transaction: async fn => {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
      catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    } };
    cleanup = async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); };
  } else {
    const engine = new PGlite();
    const wrap = client => ({ query: async (sql, params) => params ? client.query(sql, params) : (await client.exec(sql)).at(-1) });
    db = { ...wrap(engine), transaction: fn => engine.transaction(tx => fn(wrap(tx))) };
    cleanup = () => engine.close();
  }
  await migrate(db); await migrate(db);
  accountId = await createAccount(db, { email: 'first@example.test', password });
  await createAccount(db, { email: 'second@example.test', password });
  app = createApp(db, { origins: ['http://tauri.localhost'], loginLimit: 100 });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${app.address().port}`;
  token = (await request('/v1/auth/login', { email: 'first@example.test', password, deviceId: randomUUID() }, null)).body.token;
  otherToken = (await request('/v1/auth/login', { email: 'second@example.test', password, deviceId: randomUUID() }, null)).body.token;
  assert.ok(token); assert.ok(otherToken);
});
after(async () => { if (app) { app.closeAllConnections(); await new Promise(r => app.close(r)); } await cleanup?.(); });

test('health, schema migration idempotency and authentication boundaries', async () => {
  assert.equal((await request('/health/ready', undefined, null)).status, 200);
  assert.equal((await request('/v1/sync', undefined, null)).status, 401);
  const bad = await request('/v1/auth/login', { email: 'first@example.test', password: 'incorrect-password', deviceId: randomUUID() }, null);
  assert.equal(bad.status, 401);
  assert.equal((await request('/v1/me')).body.accountId, accountId);
  const rows = (await db.query('SELECT token_hash FROM sessions')).rows;
  assert.ok(rows.some(r => r.token_hash === digest(token)));
  assert.ok(rows.every(r => r.token_hash !== token));
});
test('create, add, repeat same MP3 with distinct entry IDs and preserve order', async () => {
  const a = entry(), b = entry();
  const response = await send([op('create', 0, { name: 'Minha playlist' }), op('add', 1, { entry: a }), op('add', 2, { entry: b, beforeId: a.id })]);
  assert.equal(response.status, 200);
  const list = (await request('/v1/sync')).body.playlists[0];
  assert.equal(list.version, 3); assert.deepEqual(list.entries.map(e => e.id), [b.id, a.id]);
});
test('idempotent retry does not repeat changes; mismatched operation ID rejected', async () => {
  const change = op('rename', 3, { name: 'Nova' });
  const first = await send([change]), retry = await send([change]);
  assert.equal(first.status, 200); assert.deepEqual(first, retry);
  assert.equal((await send([{ ...change, name: 'Alterada' }])).status, 409);
  assert.equal((await request('/v1/sync')).body.playlists[0].version, 4);
});
test('stale version conflict rolls entire batch back', async () => {
  const result = await send([op('rename', 4, { name: 'Não deve persistir' }), op('delete', 4)]);
  assert.equal(result.status, 409);
  const list = (await request('/v1/sync')).body.playlists[0];
  assert.equal(list.name, 'Nova'); assert.equal(list.version, 4);
});
test('concurrent devices: one write succeeds, other receives conflict', async () => {
  const results = await Promise.all([send([op('rename', 4, { name: 'A' })]), send([op('rename', 4, { name: 'B' })])]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});
test('accounts isolated on reads, writes and receipts', async () => {
  assert.equal((await request('/v1/sync', undefined, otherToken)).body.playlists.length, 0);
  const attempt = await request('/v1/sync', { operations: [op('rename', 5, { name: 'Invasão' })] }, otherToken);
  assert.equal(attempt.status, 409); assert.equal(attempt.body.details.current, null);
});
test('move/remove entries and recover a deleted playlist', async () => {
  const list = (await request('/v1/sync')).body.playlists[0];
  const [a, b] = list.entries;
  assert.equal((await send([op('move', 5, { entryId: a.id, beforeId: null }), op('remove', 6, { entryId: b.id }), op('delete', 7)])).status, 200);
  let current = (await request('/v1/sync?after=5')).body.playlists[0];
  assert.ok(current.deletedAt); assert.equal(current.entries[0].id, a.id);
  assert.equal((await send([op('rename', 8, { name: 'Excluída' })])).status, 409);
  assert.equal((await send([op('restore', 8)])).status, 200);
  current = (await request('/v1/sync?after=8')).body.playlists[0];
  assert.equal(current.deletedAt, null); assert.equal(current.version, 9);
});
test('paginated sync includes every playlist and later edits', async () => {
  const changes = Array.from({ length: 24 }, (_, i) => op('create', 0, { playlistId: randomUUID(), name: `Lista ${i}` }));
  assert.equal((await send(changes)).status, 200);
  const first = (await request('/v1/sync')).body;
  assert.equal(first.playlists.length, 20); assert.equal(first.hasMore, true);
  assert.equal((await send([op('rename', 9, { name: 'Atualizada durante paginação' })])).status, 200);
  const next = (await request(`/v1/sync?after=${first.nextCursor}`)).body;
  assert.equal(next.hasMore, false); assert.ok(next.playlists.some(p => p.id === pid && p.version === 10));
  assert.equal(new Set([...first.playlists, ...next.playlists].map(p => p.id)).size, 25);
  assert.equal((await request(`/v1/sync?after=${next.nextCursor}`)).body.playlists.length, 0);
});
test('invalid hashes, cursors, batch sizes and unknown fields rejected', async () => {
  const invalid = entry(); invalid.file.id = '../track.mp3';
  assert.equal((await send([op('add', 10, { entry: invalid })])).status, 400);
  assert.equal((await request('/v1/sync?after=-1')).status, 400);
  assert.equal((await send(Array.from({ length: 51 }, () => op('delete', 10)))).status, 400);
  assert.equal((await send([op('delete', 10, { accountId: randomUUID() })])).status, 400);
});
test('CORS blocks unknown origins and allows desktop preflight', async () => {
  assert.equal((await fetch(url + '/health/live', { headers: { origin: 'https://untrusted.test' } })).status, 403);
  const allowed = await fetch(url + '/v1/sync', { method: 'OPTIONS', headers: { origin: 'http://tauri.localhost' } });
  assert.equal(allowed.status, 204); assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://tauri.localhost');
});
test('sessions expire, can be revoked and a new login revokes same device token', async () => {
  const deviceId = randomUUID();
  const a = (await request('/v1/auth/login', { email: 'first@example.test', password, deviceId }, null)).body.token;
  const b = (await request('/v1/auth/login', { email: 'first@example.test', password, deviceId }, null)).body.token;
  assert.equal((await request('/v1/me', undefined, a)).status, 401);
  assert.equal((await request('/v1/auth/logout', {}, b)).status, 200);
  assert.equal((await request('/v1/me', undefined, b)).status, 401);
  await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [digest(otherToken)]);
  assert.equal((await request('/v1/me', undefined, otherToken)).status, 401);
});
test('login rate limit is enforced', async () => {
  const limited = createApp(db, { loginLimit: 1 });
  await new Promise(r => limited.listen(0, '127.0.0.1', r));
  try {
    const loginUrl = `http://127.0.0.1:${limited.address().port}/v1/auth/login`;
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
    assert.equal((await fetch(loginUrl, options)).status, 400);
    const blocked = await fetch(loginUrl, options);
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60');
  } finally { limited.closeAllConnections(); await new Promise(r => limited.close(r)); }
});
test('oversized body rejected and service remains usable', async () => {
  const response = await request('/v1/sync', { operations: [], padding: 'x'.repeat(140000) });
  assert.equal(response.status, 413);
  assert.equal((await request('/v1/me')).status, 200);
});
test('logout-all revokes every device for the account', async () => {
  const extra = (await request('/v1/auth/login', { email: 'first@example.test', password, deviceId: randomUUID() }, null)).body.token;
  assert.equal((await request('/v1/auth/logout-all', {})).status, 200);
  assert.equal((await request('/v1/me')).status, 401);
  assert.equal((await request('/v1/me', undefined, extra)).status, 401);
});
