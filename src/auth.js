import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
const scrypt = promisify(scryptCallback);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const digest = text => createHash('sha256').update(text).digest('hex');
export const credentials = z.object({ email: z.string().trim().pipe(z.email().max(254)).transform(s => s.toLowerCase()), password: z.string().min(12).max(256) });
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64, options)).toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [salt, hash] = encoded.split(':');
  const actual = await scrypt(password, salt, 64, options);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function createAccount(db, input) {
  const { email, password } = credentials.parse(input);
  const id = randomUUID();
  await db.query('INSERT INTO accounts(id,email,password_hash) VALUES($1,$2,$3)', [id, email, await hashPassword(password)]);
  return id;
}
export async function login(db, input) {
  const data = credentials.extend({ deviceId: z.uuid() }).strict().parse(input);
  const account = (await db.query('SELECT id,password_hash FROM accounts WHERE email=$1', [data.email])).rows[0];
  // Execute the same expensive derivation even if the account does not exist.
  const valid = await verifyPassword(data.password, account?.password_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`);
  if (!account || !valid) return null;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await db.transaction(async client => {
    await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [account.id]);
    await client.query('DELETE FROM sessions WHERE account_id=$1 AND (device_id=$2 OR expires_at<=now())', [account.id, data.deviceId]);
    const count = Number((await client.query('SELECT count(*) AS n FROM sessions WHERE account_id=$1', [account.id])).rows[0].n);
    if (count >= 20) throw Object.assign(new Error('Limite de dispositivos atingido.'), { status: 409 });
    await client.query('INSERT INTO sessions(token_hash,account_id,device_id,expires_at) VALUES($1,$2,$3,$4)', [digest(token), account.id, data.deviceId, expiresAt]);
  });
  return { token, expiresAt, accountId: account.id };
}

export async function register(db, input) {
  const data = credentials.extend({ deviceId: z.uuid() }).strict().parse(input);
  const accountId = randomUUID();
  const passwordHash = await hashPassword(data.password);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  // Account and first session are committed together. Concurrent attempts cannot
  // replace an existing password or grant curator privileges.
  await db.transaction(async client => {
    const result = await client.query('INSERT INTO accounts(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id', [accountId, data.email, passwordHash]);
    if (!result.rows.length) throw Object.assign(new Error('Não foi possível cadastrar esse e-mail. Se já possui uma conta, entre com sua senha.'), { status: 409 });
    await client.query('INSERT INTO sessions(token_hash,account_id,device_id,expires_at) VALUES($1,$2,$3,$4)', [digest(token), accountId, data.deviceId, expiresAt]);
  });
  return { token, expiresAt, accountId };
}
