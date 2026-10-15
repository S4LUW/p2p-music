import { z } from 'zod';
import { digest } from './auth.js';
const id = z.uuid();
const base = { operationId: id, playlistId: id, baseVersion: z.number().int().min(0).max(2147483646) };
const name = z.string().trim().min(1).max(200);
const entry = z.object({ id, file: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().min(1).max(255), size: z.number().int().positive().max(104857600) }).strict() }).strict();
const operation = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('create'), name }).strict(),
  z.object({ ...base, type: z.literal('rename'), name }).strict(),
  z.object({ ...base, type: z.literal('add'), entry, beforeId: id.nullable().default(null) }).strict(),
  z.object({ ...base, type: z.literal('remove'), entryId: id }).strict(),
  z.object({ ...base, type: z.literal('move'), entryId: id, beforeId: id.nullable() }).strict(),
  z.object({ ...base, type: z.literal('delete') }).strict(),
  z.object({ ...base, type: z.literal('restore') }).strict(),
]);
export const pushSchema = z.object({ operations: z.array(operation).min(1).max(50) }).strict();
export function problem(status, message, details) { return Object.assign(new Error(message), { status, details }); }
export function serialize(row) {
  return { id: row.id, name: row.name, entries: row.entries, version: row.version, revision: String(row.revision), deletedAt: row.deleted_at, updatedAt: row.updated_at };
}
export async function push(db, accountId, input) {
  const { operations } = pushSchema.parse(input);
  return db.transaction(async client => {
    // One lock per account serializes revisions, retries and concurrent devices.
    // Unlike a global sequence, a cursor cannot overtake an uncommitted write.
    const account = (await client.query('SELECT sync_revision FROM accounts WHERE id=$1 FOR UPDATE', [accountId])).rows[0];
    let revision = BigInt(account.sync_revision);
    const results = [];
    for (const op of operations) {
      const hash = digest(JSON.stringify(op));
      const receipt = (await client.query('SELECT payload_hash,result FROM operation_receipts WHERE account_id=$1 AND operation_id=$2', [accountId, op.operationId])).rows[0];
      if (receipt) {
        if (receipt.payload_hash !== hash) throw problem(409, 'operationId reutilizado com outro conteúdo.');
        results.push(receipt.result); continue;
      }
      const previous = (await client.query('SELECT * FROM playlists WHERE account_id=$1 AND id=$2', [accountId, op.playlistId])).rows[0];
      if ((previous?.version ?? 0) !== op.baseVersion || (op.type === 'create' ? !!previous : !previous)) {
        throw problem(409, 'Versão desatualizada. Sincronize antes de tentar novamente.', { operationId: op.operationId, current: previous ? serialize(previous) : null });
      }
      if (previous?.deleted_at && op.type !== 'restore') throw problem(409, 'Restaure a playlist antes de alterá-la.');
      if (op.type === 'restore' && !previous.deleted_at) throw problem(409, 'Playlist não está excluída.');
      let title = previous?.name ?? op.name;
      let entries = [...(previous?.entries ?? [])];
      let deleted = previous?.deleted_at ?? null;
      if (op.type === 'create') {
        const count = Number((await client.query('SELECT count(*) AS n FROM playlists WHERE account_id=$1', [accountId])).rows[0].n);
        if (count >= 500) throw problem(409, 'Limite de 500 playlists por conta, incluindo excluídas.');
      }
      if (op.type === 'rename') title = op.name;
      if (op.type === 'delete') deleted = new Date().toISOString();
      if (op.type === 'restore') deleted = null;
      if (op.type === 'remove' || op.type === 'move') {
        const index = entries.findIndex(e => e.id === op.entryId);
        if (index < 0) throw problem(409, 'Entrada não encontrada.');
        if (op.type === 'move' && op.beforeId === op.entryId) throw problem(400, 'Destino deve ser outra entrada.');
        const [removed] = entries.splice(index, 1);
        if (op.type === 'move') insert(entries, removed, op.beforeId);
      }
      if (op.type === 'add') {
        if (entries.length >= 1000) throw problem(409, 'Limite de 1000 entradas por playlist.');
        if (entries.some(e => e.id === op.entry.id)) throw problem(409, 'Identificador de entrada já existe.');
        insert(entries, op.entry, op.beforeId);
      }
      revision++;
      const version = (previous?.version ?? 0) + 1;
      await client.query(`INSERT INTO playlists(account_id,id,name,entries,version,revision,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(account_id,id) DO UPDATE SET name=EXCLUDED.name,entries=EXCLUDED.entries,version=EXCLUDED.version,revision=EXCLUDED.revision,deleted_at=EXCLUDED.deleted_at,updated_at=now()`,
      [accountId, op.playlistId, title, JSON.stringify(entries), version, revision.toString(), deleted]);
      const result = { operationId: op.operationId, playlistId: op.playlistId, version, revision: revision.toString() };
      await client.query('INSERT INTO operation_receipts(account_id,operation_id,payload_hash,result) VALUES($1,$2,$3,$4)', [accountId, op.operationId, hash, JSON.stringify(result)]);
      results.push(result);
    }
    await client.query('UPDATE accounts SET sync_revision=$2 WHERE id=$1', [accountId, revision.toString()]);
    // This is NOT a pull cursor: another device may have changes the caller hasn't read.
    return { results };
  });
}
function insert(entries, value, beforeId) {
  const index = beforeId === null ? entries.length : entries.findIndex(e => e.id === beforeId);
  if (index < 0) throw problem(409, 'Entrada de destino não encontrada.');
  entries.splice(index, 0, value);
}
export async function pull(db, accountId, after = '0') {
  if (!/^(0|[1-9]\d{0,18})$/.test(after) || BigInt(after) > 9223372036854775807n) throw problem(400, 'Cursor inválido.');
  const rows = (await db.query('SELECT * FROM playlists WHERE account_id=$1 AND revision>$2 ORDER BY revision LIMIT 21', [accountId, after])).rows;
  const page = rows.slice(0, 20);
  return { playlists: page.map(serialize), nextCursor: page.length ? String(page.at(-1).revision) : after, hasMore: rows.length > 20 };
}
