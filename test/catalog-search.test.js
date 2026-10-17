import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/migrate.js';
import { createAccount } from '../src/auth.js';
import { catalogWrite } from '../src/catalog.js';
import { createApp } from '../src/app.js';
let engine, db, server, url, token, accountId, artist, album, track;
async function request(query, auth = token) {
  const response = await fetch(`${url}/v1/catalog?kind=search&${query}`, { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
  return { status: response.status, body: await response.json() };
}
const search = q => request(`q=${encodeURIComponent(q)}`);
before(async () => {
  engine = new PGlite();
  const wrap = client => ({ query: async (sql, args) => args ? client.query(sql, args) : (await client.exec(sql)).at(-1) });
  db = { ...wrap(engine), transaction: fn => engine.transaction(tx => fn(wrap(tx))) };
  await migrate(db);
  accountId = await createAccount(db, { email: 'search@example.test', password: 'search-test-password-123' });
  await db.query('UPDATE accounts SET is_curator=true WHERE id=$1', [accountId]);
  artist = { kind: 'artist', id: randomUUID(), version: 0, name: 'João Aurora', biography: 'Teste de busca' };
  album = { kind: 'album', id: randomUUID(), version: 0, artistId: artist.id, title: 'Canções do Mar', releaseYear: 2026, genre: 'MPB' };
  track = { kind: 'track', id: randomUUID(), version: 0, albumId: album.id, title: 'Coração Azul', discNumber: 1, trackNumber: 1, durationSeconds: 180, file: { id: 'a'.repeat(64), name: 'audio.mp3', size: 1024 } };
  for (const item of [artist, album, track]) await catalogWrite(db, accountId, item);
  await db.query('UPDATE accounts SET is_curator=false WHERE id=$1', [accountId]);
  server = createApp(db); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(`${url}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'search@example.test', password: 'search-test-password-123', deviceId: randomUUID() }) })).json()).token;
  assert.ok(token);
});
after(async () => { server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await engine?.close(); });
test('authenticated readers search artists, albums and tracks with case/accent folding and parent context', async () => {
  assert.equal((await request('q=joao', null)).status, 401);
  for (const [query, kind] of [['JOAO', 'artist'], ['cancoes', 'album'], ['racao az', 'track'], ['CORAÇÃO', 'track']]) {
    const result = await search(query); assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.items.length, 1); assert.equal(result.body.items[0].kind, kind);
    assert.equal(result.body.items[0].artist.id, artist.id);
  }
  const item = (await search('coração')).body.items[0];
  assert.equal(item.album.id, album.id); assert.equal(item.album.artistId, artist.id);
  assert.equal(item.track.albumId, album.id); assert.deepEqual(item.track.file, track.file);
});
test('empty, short and invalid searches are bounded; punctuation is literal', async () => {
  assert.deepEqual((await search('')).body, { items: [], nextOffset: null });
  assert.deepEqual((await search('a')).body.items, []);
  assert.equal((await search('a'.repeat(101))).status, 400);
  assert.equal((await request('q=test&offset=-1')).status, 400);
  assert.equal((await search("' OR 1=1 --")).body.items.length, 0);
  await db.query('INSERT INTO catalog_artists(id,name,updated_by) VALUES($1,$2,$3)', [randomUUID(), '100%_real', accountId]);
  assert.equal((await search('%_')).body.items.length, 1);
  assert.equal((await search('inexistente')).body.items.length, 0);
});
test('mixed results prefer exact matches and pagination is stable without duplicate items', async () => {
  await db.query('INSERT INTO catalog_artists(id,name,updated_by) VALUES($1,$2,$3)', [randomUUID(), 'Aurora', accountId]);
  await db.query('INSERT INTO catalog_albums(id,artist_id,title,updated_by) VALUES($1,$2,$3,$4)', [randomUUID(), artist.id, 'Aurora ao vivo', accountId]);
  const items = (await search('aurora')).body.items;
  assert.deepEqual(items.map(i => i.kind), ['artist', 'album', 'artist']);
  assert.equal(items[0].artist.name, 'Aurora');
  for (let i = 0; i < 51; i++) await db.query('INSERT INTO catalog_artists(id,name,updated_by) VALUES($1,$2,$3)', [randomUUID(), `Página ${String(i).padStart(2,'0')}`, accountId]);
  const first = (await search('pagina')).body;
  const second = (await request('q=pagina&offset=50')).body;
  assert.equal(first.items.length, 50); assert.equal(first.nextOffset, 50);
  assert.equal(second.items.length, 1); assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.items, ...second.items].map(i => i.artist.id)).size, 51);
  assert.deepEqual((await search('pagina')).body, first);
});
test('catalog edits are reflected in search without changing the MP3 reference', async () => {
  await db.query('UPDATE accounts SET is_curator=true WHERE id=$1', [accountId]);
  await catalogWrite(db, accountId, { ...track, version: 1, title: 'Novo Amanhecer' });
  assert.equal((await search('Coração Azul')).body.items.length, 0);
  const item = (await search('amanhecer')).body.items[0];
  assert.equal(item.track.id, track.id); assert.deepEqual(item.track.file, track.file);
});
