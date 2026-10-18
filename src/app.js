import { createServer } from 'node:http';
import { ZodError } from 'zod';
import { digest, login, register } from './auth.js';
import { problem, pull, push } from './sync.js';
import { createDiscovery } from './discovery.js';
import { catalogRead, catalogWrite } from './catalog.js';

export function createApp(db, { origins = [], loginLimit = 20, registerLimit = 5 } = {}) {
  const buckets = new Map();
  const discovery = createDiscovery();
  let activeLogins = 0;
  function rate(key, limit) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (buckets.size >= 10000) {
        for (const [k, b] of buckets) if (b.until <= now) buckets.delete(k);
        if (buckets.size >= 10000) throw problem(429, 'Tente novamente em um minuto.');
      }
      bucket = { count: 0, until: now + 60000 }; buckets.set(key, bucket);
    }
    if (++bucket.count > limit) throw problem(429, 'Tente novamente em um minuto.');
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.origin) {
        if (!origins.includes(req.headers.origin)) throw problem(403, 'Origem não permitida.');
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.writeHead(204); res.end(); return;
      }
      const url = new URL(req.url, 'http://api.local');
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /health/live') { send(200, { status: 'ok' }); return; }
      if (route === 'GET /health/ready') {
        await db.query('SELECT name FROM schema_migrations LIMIT 1');
        send(200, { status: 'ready' }); return;
      }
      // Do not trust client-supplied X-Forwarded-For. The proxy can add a separate
      // edge limit; this conservative socket limit applies per instance/proxy.
      rate(`ip:${req.socket.remoteAddress}`, 600);
      if (route === 'POST /v1/auth/login' || route === 'POST /v1/auth/register') {
        const registering = route === 'POST /v1/auth/register';
        rate(`${registering ? 'register' : 'login'}:${req.socket.remoteAddress}`, registering ? registerLimit : loginLimit);
        const body = await readJson(req, 4096);
        if (activeLogins >= 2) throw problem(429, 'Autenticação ocupada. Tente novamente.');
        activeLogins++;
        try {
          const result = await (registering ? register : login)(db, body);
          if (!result) throw problem(401, 'Credenciais inválidas.');
          send(registering ? 201 : 200, result);
        } finally { activeLogins--; }
        return;
      }
      const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      if (!token) throw problem(401, 'Autenticação necessária.');
      const tokenHash = digest(token);
      const session = (await db.query('SELECT account_id,device_id FROM sessions WHERE token_hash=$1 AND expires_at>now()', [tokenHash])).rows[0];
      if (!session) throw problem(401, 'Sessão expirada ou inválida.');
      rate(`account:${session.account_id}`, 120);
      if (route === 'GET /v1/catalog') { send(200, await catalogRead(db, session.account_id, url.searchParams)); return; }
      if (route === 'POST /v1/catalog') {
        rate(`catalog-write:${session.account_id}`, 30);
        send(200, await catalogWrite(db, session.account_id, await readJson(req))); return;
      }
      if (route === 'POST /v1/network/heartbeat') {
        rate(`presence:${session.account_id}:${session.device_id}`, 3);
        send(200, discovery.heartbeat(session, await readJson(req, 1024 * 1024))); return;
      }
      if (route === 'POST /v1/network/sources') { send(200, discovery.sources(await readJson(req, 16384))); return; }
      if (route === 'GET /v1/me') { send(200, { accountId: session.account_id, deviceId: session.device_id }); return; }
      if (route === 'POST /v1/auth/logout') {
        discovery.remove(session);
        await db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]); send(200, { ok: true }); return;
      }
      if (route === 'POST /v1/auth/logout-all') {
        await db.query('DELETE FROM sessions WHERE account_id=$1', [session.account_id]); send(200, { ok: true }); return;
      }
      if (route === 'GET /v1/sync') { send(200, await pull(db, session.account_id, url.searchParams.get('after') ?? '0')); return; }
      if (route === 'POST /v1/sync') { send(200, await push(db, session.account_id, await readJson(req))); return; }
      throw problem(404, 'Rota não encontrada.');
    } catch (error) {
      const status = error instanceof ZodError ? 400 : error.status ?? 500;
      if (status === 429) res.setHeader('Retry-After', '60');
      if (status >= 500) console.error('Request failed', error.code ?? error.name);
      if (!res.headersSent) send(status, { error: status >= 500 ? 'Serviço temporariamente indisponível.' : error instanceof ZodError ? 'Dados inválidos.' : error.message, ...(error.details ? { details: error.details } : {}) });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.timeout = 20000;
  server.keepAliveTimeout = 5000;
  return server;
}

async function readJson(req, limit = 131072) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw problem(415, 'Envie application/json.');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw problem(413, 'Corpo excede o limite.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw problem(400, 'JSON inválido.'); }
}
