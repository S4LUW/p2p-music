import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../src/migrate.js';
import {catalogWrite,catalogRead} from '../src/catalog.js';

test('illustrations support restricted runtime, search, legacy edits and removal; invalid URLs and readers are rejected',async()=>{
 const engine=new PGlite();
 const wrap=c=>({query:(s,p)=>p?c.query(s,p):c.exec(s).then(r=>r.at(-1))});
 const db={...wrap(engine),transaction:fn=>engine.transaction(tx=>fn(wrap(tx)))};
 try {
  await migrate(db);
  const curator=randomUUID(),reader=randomUUID();
  await db.query('INSERT INTO accounts(id,email,password_hash,is_curator) VALUES($1,$2,$3,true),($4,$5,$3,false)',[curator,'curator@images.test','unused',reader,'reader@images.test']);
  await engine.exec(await readFile(new URL('../scripts/runtime-role.sql',import.meta.url),'utf8'));
  await engine.exec('SET ROLE p2p_music_runtime');
  const url='https://images.example.test/image?id=123&size=300';
  const artist={kind:'artist',id:randomUUID(),version:0,name:'Illustration artist',biography:''};
  const album={kind:'album',id:randomUUID(),version:0,artistId:artist.id,title:'Illustration album',releaseYear:null,genre:''};
  for(const entity of [artist,album]) {
   const created=await catalogWrite(db,curator,{...entity,illustrationUrl:`  ${url}  `});
   assert.equal(created.item.illustrationUrl,url);
   const edited=await catalogWrite(db,curator,{...entity,version:1});
   assert.equal(edited.item.illustrationUrl,url,'legacy writes preserve the URL');
   const params=new URLSearchParams({kind:entity.kind,...(entity.kind==='album'?{parent:artist.id}:{})});
   assert.equal((await catalogRead(db,reader,params)).items[0].illustrationUrl,url);
   for(const bad of ['http://example.test/a','javascript:alert(1)','data:image/png;base64,a','file:///a','/image.png','https://user:password@example.test/a','https://example.test/'+ 'a'.repeat(2048)]) {
    await assert.rejects(catalogWrite(db,curator,{...entity,version:2,illustrationUrl:bad}));
   }
   await assert.rejects(catalogWrite(db,reader,{...entity,version:2,illustrationUrl:url}),e=>e.status===403);
  }
  const search=await catalogRead(db,reader,new URLSearchParams({kind:'search',q:'Illustration'}));
  assert.ok(JSON.stringify(search).includes(url));
  assert.ok(search.items.length>=2);
  for(const entity of [artist,album]) {
   assert.equal((await catalogWrite(db,curator,{...entity,version:2,illustrationUrl:''})).item.illustrationUrl,null);
   assert.equal((await catalogWrite(db,curator,{...entity,version:3,illustrationUrl:url})).item.illustrationUrl,url);
   assert.equal((await catalogWrite(db,curator,{...entity,version:4,illustrationUrl:null})).item.illustrationUrl,null);
  }
 } finally {await engine.close();}
});
