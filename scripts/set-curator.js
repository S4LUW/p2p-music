import { createDb } from '../src/db.js';
const email = (process.env.CURATOR_EMAIL ?? '').trim().toLowerCase();
if (!email || !['true','false'].includes(process.env.CURATOR_ENABLED ?? '')) throw new Error('Defina CURATOR_EMAIL e CURATOR_ENABLED=true ou false.');
const db = createDb();
try {
  const result = await db.query('UPDATE accounts SET is_curator=$2 WHERE email=$1 RETURNING id',[email,process.env.CURATOR_ENABLED === 'true']);
  if (!result.rows.length) throw new Error('Conta não encontrada.');
  console.log('Permissão de curadoria atualizada.');
} finally { await db.close(); }
