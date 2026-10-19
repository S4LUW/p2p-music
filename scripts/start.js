if (!['true','false'].includes(process.env.MIGRATE_ON_START ?? 'true')) throw new Error('MIGRATE_ON_START deve ser true ou false.');
if (process.env.MIGRATE_ON_START !== 'false') {
 const {createDb} = await import('../src/db.js');
 const {migrate} = await import('../src/migrate.js');
 const db = createDb();
 try {await migrate(db);} finally {await db.close();}
}
await import('../src/server.js');
