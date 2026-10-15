import { createDb } from '../src/db.js';
import { createAccount } from '../src/auth.js';
const db = createDb();
try {
  const id = await createAccount(db, { email: process.env.ACCOUNT_EMAIL, password: process.env.ACCOUNT_PASSWORD });
  console.log(`Account created: ${id}`);
} catch { console.error('Account creation failed. Check credentials (password: 12–256 characters), existing email and database configuration.'); process.exitCode = 1; }
finally { delete process.env.ACCOUNT_PASSWORD; await db.close(); }
