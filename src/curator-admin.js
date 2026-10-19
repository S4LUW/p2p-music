// Administrative CLI only. Never import into the HTTP route table.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const input = z.object({
 email: z.string().trim().pipe(z.email().max(254)).transform(s => s.toLowerCase()),
 enabled: z.boolean(), reason: z.string().trim().min(8).max(500),
}).strict();
export async function setCurator(db, values) {
 const data = input.parse(values);
 return db.transaction(async client => {
  const account = (await client.query('SELECT id,is_curator FROM accounts WHERE email=$1 FOR UPDATE',[data.email])).rows[0];
  if (!account) throw new Error('Conta não encontrada.');
  if (account.is_curator === data.enabled) return {changed:false, revokedSessions:0};
  await client.query('UPDATE accounts SET is_curator=$2 WHERE id=$1',[account.id,data.enabled]);
  const revoked = await client.query('DELETE FROM sessions WHERE account_id=$1 RETURNING token_hash',[account.id]);
  await client.query('INSERT INTO curator_role_audit(id,account_id,previous_enabled,enabled,reason) VALUES($1,$2,$3,$4,$5)',[randomUUID(),account.id,account.is_curator,data.enabled,data.reason]);
  return {changed:true,revokedSessions:revoked.rows.length};
 });
}
