import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
const db = createDb();
try { await migrate(db); console.log('Migrations applied.'); }
finally { await db.close(); }
