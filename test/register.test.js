import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/migrate.js';
import { digest, register, verifyPassword } from '../src/auth.js';
import { createApp } from '../src/app.js';
let engine, db, server, url;
const password = 'test-register-password-123';
const input = email => ({email, password, deviceId: randomUUID()});
async function request(path, body, token, base = url) {
 const response = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST', headers: {'content-type':'application/json', ...(token ? {authorization:`Bearer ${token}`} : {})}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
 return {status:response.status, body:await response.json(), retry:response.headers.get('retry-after')};
}
before(async () => {
 engine = new PGlite();
 const wrap = client => ({query:async (sql,args) => args ? client.query(sql,args) : (await client.exec(sql)).at(-1)});
 db = {...wrap(engine),transaction:fn => engine.transaction(tx => fn(wrap(tx)))};
 await migrate(db);
 server = createApp(db,{registerLimit:100});
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));await engine?.close();});
test('registration creates a reader, hashes secrets and immediately authenticates the device',async()=>{
 const data = input('  New.User@EXAMPLE.test  ');
 const result = await request('/v1/auth/register',data);
 assert.equal(result.status,201,JSON.stringify(result.body));
 assert.deepEqual(Object.keys(result.body).sort(),['accountId','expiresAt','token']);
 const account = (await db.query('SELECT * FROM accounts WHERE id=$1',[result.body.accountId])).rows[0];
 assert.equal(account.email,'new.user@example.test');assert.equal(account.is_curator,false);
 assert.notEqual(account.password_hash,password);assert.ok(await verifyPassword(password,account.password_hash));
 const session = (await db.query('SELECT * FROM sessions WHERE account_id=$1',[account.id])).rows[0];
 assert.equal(session.token_hash,digest(result.body.token));assert.equal(session.device_id,data.deviceId);
 assert.deepEqual((await request('/v1/me',undefined,result.body.token)).body,{accountId:account.id,deviceId:data.deviceId});
 assert.equal((await request('/v1/catalog',{kind:'artist',id:randomUUID(),version:0,name:'Forbidden',biography:''},result.body.token)).status,403);
 assert.equal((await request('/v1/auth/login',{...data,email:'new.user@example.test'})).status,200);
});
test('duplicate and concurrent registrations never overwrite an account or its password',async()=>{
 const data = input('race@example.test');
 const results = await Promise.all([request('/v1/auth/register',data),request('/v1/auth/register',{...data,email:'RACE@example.test'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 assert.equal((await request('/v1/auth/register',{...data,password:'another-password-456'})).status,409);
 const rows = (await db.query('SELECT * FROM accounts WHERE email=$1',[data.email])).rows;
 assert.equal(rows.length,1);assert.ok(await verifyPassword(password,rows[0].password_hash));
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM sessions WHERE account_id=$1',[rows[0].id])).rows[0].n),1);
});
test('invalid input and privilege fields are rejected without creating accounts',async()=>{
 const data = input('invalid@example.test');
 for(const changes of [{email:'not-an-email'},{password:'short'},{password:'a'.repeat(257)},{deviceId:'bad'},{is_curator:true},{name:'Unneeded'}]) {
  assert.equal((await request('/v1/auth/register',{...data,...changes})).status,400);
 }
 assert.equal((await request('/v1/auth/register',{...data,password:'a'.repeat(5000)})).status,413);
 assert.equal((await db.query('SELECT id FROM accounts WHERE email=$1',[data.email])).rows.length,0);
});
test('session failure rolls back the account creation',async()=>{
 const failing = {...db,transaction:fn=>db.transaction(client=>fn({query:(sql,args)=>{
  if(sql.startsWith('INSERT INTO sessions'))throw new Error('simulated session failure');
  return client.query(sql,args);
 }}))};
 await assert.rejects(register(failing,input('rollback@example.test')),/simulated session failure/);
 assert.equal((await db.query('SELECT id FROM accounts WHERE email=$1',['rollback@example.test'])).rows.length,0);
});
test('registration attempts are rate limited with retry guidance',async()=>{
 const limited=createApp(db,{registerLimit:1});await new Promise(resolve=>limited.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${limited.address().port}`;
 try {
  assert.equal((await request('/v1/auth/register',{},undefined,base)).status,400);
  const result=await request('/v1/auth/register',input('limited@example.test'),undefined,base);
  assert.equal(result.status,429);assert.equal(result.retry,'60');
 } finally {limited.closeAllConnections();await new Promise(resolve=>limited.close(resolve));}
});
