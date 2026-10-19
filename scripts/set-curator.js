import { createDb } from '../src/db.js';
import { setCurator } from '../src/curator-admin.js';
if (!['true','false'].includes(process.env.CURATOR_ENABLED ?? '')) throw new Error('Defina CURATOR_ENABLED=true ou false.');
if (!process.env.ADMIN_DATABASE_URL) throw new Error('Defina ADMIN_DATABASE_URL temporariamente neste comando administrativo. Não salve essa credencial no ambiente da API.');
const db = createDb({connectionString:process.env.ADMIN_DATABASE_URL});
try {
 const result = await setCurator(db,{email:process.env.CURATOR_EMAIL,enabled:process.env.CURATOR_ENABLED === 'true',reason:process.env.CURATOR_REASON});
 console.log(result.changed ? `Permissão atualizada e auditada. ${result.revokedSessions} sessões encerradas; faça login novamente.` : 'A conta já possui essa permissão. Nenhuma alteração realizada.');
} finally { await db.close(); }
