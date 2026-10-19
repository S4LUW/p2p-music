import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../src/migrate.js';
import {createAccount,login,register} from '../src/auth.js';
import {setCurator} from '../src/curator-admin.js';
import {catalogWrite} from '../src/catalog.js';
import {push} from '../src/sync.js';
import {createApp} from '../src/app.js';
let engine,db,server,url,reader,curator,readerToken,curatorToken;
const password='security-test-password-123';
const artist=()=>({kind:'artist',id:randomUUID(),version:0,name:'Security test',biography:''});
async function request(path,body,token=readerToken,headers={},method='POST') {
 const r=await fetch(url+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`} : {}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:r.status,body:r.status===204?null:await r.json()};
}
before(async()=>{
 engine=new PGlite(); const wrap=c=>({query:(s,p)=>p?c.query(s,p):c.exec(s).then(r=>r.at(-1))});
 db={...wrap(engine),transaction:fn=>engine.transaction(tx=>fn(wrap(tx)))};
 await migrate(db);
 reader=await createAccount(db,{email:'reader@security.test',password});
 curator=await createAccount(db,{email:'curator@security.test',password});
 await setCurator(db,{email:'curator@security.test',enabled:true,reason:'Initial authorized curator'});
 readerToken=(await login(db,{email:'reader@security.test',password,deviceId:randomUUID()})).token;
 curatorToken=(await login(db,{email:'curator@security.test',password,deviceId:randomUUID()})).token;
 server=createApp(db,{loginLimit:100,registerLimit:100});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await engine?.close();});
test('client roles, account impersonation and extra fields cannot grant privileges',async()=>{
 for(const extra of [{is_curator:true},{isCurator:true},{curator:true},{role:'curator'},{roles:['admin']},{accountId:curator},{permissions:['catalog:write']},JSON.parse('{"__proto__":{"is_curator":true}}')]) {
  const credentials={email:'injected@security.test',password,deviceId:randomUUID(),...extra};
  assert.equal((await request('/v1/auth/register',credentials,null)).status,400);
  assert.equal((await request('/v1/auth/login',{...credentials,email:'reader@security.test'},null)).status,400);
  assert.equal((await request('/v1/catalog',{...artist(),...extra})).status,403);
 }
 assert.equal((await db.query('SELECT is_curator FROM accounts WHERE id=$1',[reader])).rows[0].is_curator,false);
 assert.equal((await db.query('SELECT id FROM accounts WHERE email=$1',['injected@security.test'])).rows.length,0);
});
test('all catalog mutations reject readers regardless of forged headers, target IDs or method override',async()=>{
 const a=artist();assert.equal((await request('/v1/catalog',a,curatorToken)).status,200);
 const album={kind:'album',id:randomUUID(),version:0,artistId:a.id,title:'Album',releaseYear:null,genre:''};
 assert.equal((await request('/v1/catalog',album,curatorToken)).status,200);
 const track={kind:'track',id:randomUUID(),version:0,albumId:album.id,title:'Track',discNumber:1,trackNumber:1,durationSeconds:null,file:{id:'a'.repeat(64),size:1000,name:'test.mp3'}};
 assert.equal((await request('/v1/catalog',track,curatorToken)).status,200);
 for(const entity of [a,album,track]) for(const payload of [{...entity,id:randomUUID()},{...entity,version:1}]) {
  assert.equal((await request(`/v1/catalog?accountId=${curator}&is_curator=true`,payload,readerToken,{'x-user-id':curator,'x-role':'curator','x-forwarded-user':curator,'x-http-method-override':'PUT'})).status,403);
 }
 for(const path of ['/v1/accounts/role','/v1/admin/curator','/v1/auth/set-curator','/scripts/set-curator.js']) {
  assert.equal((await request(path,{accountId:reader,is_curator:true})).status,404);
 }
 for(const token of [null,randomBytes(32).toString('base64url'),'eyJhbGciOiJub25lIn0.eyJyb2xlIjoiY3VyYXRvciJ9.']) assert.equal((await request('/v1/catalog',artist(),token)).status,401);
 assert.equal((await request('/v1/catalog', {...a,version:1,is_curator:true},curatorToken)).status,400);
 assert.equal((await db.query('SELECT version FROM catalog_artists WHERE id=$1',[a.id])).rows[0].version,1);
});
test('promotion and revocation invalidate every old session and require a fresh login',async()=>{
 const email='promotion@security.test';const id=await createAccount(db,{email,password});
 const first=await login(db,{email,password,deviceId:randomUUID()});const second=await login(db,{email,password,deviceId:randomUUID()});
 const grant=await setCurator(db,{email,enabled:true,reason:'Approved by application operator'});assert.equal(grant.revokedSessions,2);
 for(const s of [first,second]) assert.equal((await request('/v1/catalog',artist(),s.token)).status,401);
 const fresh=await login(db,{email,password,deviceId:randomUUID()});assert.equal((await request('/v1/catalog',artist(),fresh.token)).status,200);
 await setCurator(db,{email,enabled:false,reason:'Curator access revoked by operator'});
 assert.equal((await request('/v1/catalog',artist(),fresh.token)).status,401);
 const readerSession=await login(db,{email,password,deviceId:randomUUID()});assert.equal((await request('/v1/catalog',artist(),readerSession.token)).status,403);
 const events=(await db.query('SELECT * FROM curator_role_audit WHERE account_id=$1 ORDER BY changed_at',[id])).rows;
 assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.enabled),[true,false]);assert.ok(events.every(e=>e.database_actor && e.reason));
});
test('role changes fail atomically when audit insertion fails and invalid administrative input is rejected',async()=>{
 const failing={transaction:fn=>db.transaction(c=>fn({query:(sql,args)=>{
  if(sql.startsWith('INSERT INTO curator_role_audit'))throw new Error('audit unavailable');return c.query(sql,args);
 }}))};
 await assert.rejects(setCurator(failing,{email:'reader@security.test',enabled:true,reason:'Rollback audit test'}),/audit unavailable/);
 assert.equal((await db.query('SELECT is_curator FROM accounts WHERE id=$1',[reader])).rows[0].is_curator,false);
 assert.equal((await request('/v1/me',undefined,readerToken,{},'GET')).status,200);
 await assert.rejects(setCurator(db,{email:'reader@security.test',enabled:'true',reason:'Invalid bool test'}));
 await assert.rejects(setCurator(db,{email:'reader@security.test',enabled:true,reason:''}));
 await assert.rejects(catalogWrite({transaction:fn=>fn({query:async()=>({rows:[{is_curator:'false'}]})})},reader,artist()),e=>e.status===403);
});
test('restricted database role cannot grant curator access or alter audit but supports normal application operations',async()=>{
 await engine.exec(await readFile(new URL('../scripts/runtime-role.sql',import.meta.url),'utf8'));
 await engine.exec('SET ROLE p2p_music_runtime');
 try {
  for(const sql of ["UPDATE accounts SET is_curator=true", "INSERT INTO accounts(id,email,password_hash,is_curator) VALUES(gen_random_uuid(),'bad@security.test','bad',true)", 'DELETE FROM curator_role_audit', 'ALTER TABLE accounts ALTER COLUMN is_curator SET DEFAULT true', 'ALTER ROLE p2p_music_runtime SUPERUSER']) {
   await assert.rejects(db.query(sql),e=>e.code==='42501');
  }
  const account=await register(db,{email:'restricted@security.test',password,deviceId:randomUUID()});
  const session=await login(db,{email:'restricted@security.test',password,deviceId:randomUUID()});assert.ok(session.token);
  assert.equal((await db.query('SELECT is_curator FROM accounts WHERE id=$1',[account.accountId])).rows[0].is_curator,false);
  await push(db,account.accountId,{operations:[{operationId:randomUUID(),playlistId:randomUUID(),type:'create',baseVersion:0,name:'Works with restricted role'}]});
  await assert.rejects(catalogWrite(db,account.accountId,artist()),e=>e.status===403);
  await catalogWrite(db,curator,artist());
 } finally {await engine.exec('RESET ROLE');}
});
