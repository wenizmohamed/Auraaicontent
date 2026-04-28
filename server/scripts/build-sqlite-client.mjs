// Generates the SQLite-shaped Prisma client into a separate output dir
// (node_modules/.prisma/client-sqlite) so it coexists with the default
// Postgres client used by the VPS build. Called by `pnpm build:desktop`
// from server/package.json (added in Task A7).
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');

console.log('[build-sqlite-client] generating client → node_modules/.prisma/client-sqlite');
execSync('npx prisma generate --schema=prisma/schema-sqlite.prisma', {
  cwd: serverDir,
  stdio: 'inherit',
});
console.log('[build-sqlite-client] done');
