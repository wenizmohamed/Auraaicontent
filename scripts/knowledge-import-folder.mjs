#!/usr/bin/env node
/**
 * Import every file in a folder into one client's knowledge base.
 *
 * Runs on the server against the built app (same storage, metering and reader
 * the Upload Files button uses), so a whole folder can be loaded without
 * clicking through the UI. Subfolders are walked; the item title keeps the
 * relative path so files stay recognisable. Files already in the client's
 * knowledge base under the same title are skipped, so it is safe to re-run.
 *
 *   node scripts/knowledge-import-folder.mjs <folder> <clientId> [--dry] [--all]
 *
 * Only document and media types are imported (PDF, Office, text, images,
 * audio, video). Source code, archives and other files are skipped unless
 * --all is passed.
 *   PROD_DIR=/opt/radix-v2/server node scripts/knowledge-import-folder.mjs ./docs cmv...
 *
 * Exits 0 when every file was imported or skipped, 1 if any failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [folderArg, clientId, ...flags] = process.argv.slice(2);
if (!folderArg || !clientId) {
  console.error('usage: knowledge-import-folder.mjs <folder> <clientId> [--dry] [--all]');
  process.exit(2);
}
const DRY = flags.includes('--dry');
const ALL = flags.includes('--all');
const PROD_DIR = process.env.PROD_DIR || '/opt/radix-v2/server';
const folder = path.resolve(folderArg);
const MAX_BYTES = 50 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build']);
const SKIP_FILES = /^(thumbs\.db|desktop\.ini|\.ds_store)$|^~\$|\.(lnk|tmp|crdownload|part)$/i;
const MIME = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html', '.rtf': 'application/rtf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};

const notDocuments = [];
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // never follow links out of the folder
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, out); continue; }
    if (!entry.isFile() || SKIP_FILES.test(entry.name)) continue;
    if (!ALL && !MIME[path.extname(entry.name).toLowerCase()]) { notDocuments.push(full); continue; }
    out.push(full);
  }
  return out;
}

if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
  console.error(`not a folder: ${folder}`);
  process.exit(2);
}
const files = walk(folder).sort();
console.log(`${files.length} file(s) under ${folder}${DRY ? ' (dry run)' : ''}`);
if (notDocuments.length) {
  const exts = [...new Set(notDocuments.map((f) => path.extname(f).toLowerCase() || '(no extension)'))].sort().join(' ');
  console.log(`${notDocuments.length} other file(s) left out as not documents: ${exts}`);
}
if (DRY) { for (const f of files) console.log('  ' + path.relative(folder, f)); process.exit(0); }

process.chdir(PROD_DIR);
await import(pathToFileURL(path.join(PROD_DIR, 'node_modules/dotenv/config.js')).href);
const mod = (rel) => import(pathToFileURL(path.join(PROD_DIR, 'dist', rel)).href);
const { db, systemDb } = await mod('db/prisma.js');
const { storageService } = await mod('services/storage.service.js');
const { knowledgeService } = await mod('services/knowledge.service.js');
const { embedKnowledgeItem } = await mod('workers/embeddings.worker.js');

const client = await (systemDb ?? db).client.findFirst({ where: { id: clientId }, select: { id: true, name: true, orgId: true } });
if (!client) { console.error(`client not found: ${clientId}`); process.exit(2); }
const orgId = client.orgId;
const existing = new Set((await db.knowledgeItem.findMany({ where: { orgId, clientId }, select: { title: true } })).map((k) => k.title));
console.log(`client: ${client.name} (${existing.size} item(s) already in its knowledge base)\n`);

let imported = 0, skipped = 0, failed = 0;
for (const file of files) {
  const title = path.relative(folder, file).split(path.sep).join('/');
  const size = fs.statSync(file).size;
  if (existing.has(title)) { skipped++; console.log(`SKIP  ${title} (already there)`); continue; }
  if (size === 0) { skipped++; console.log(`SKIP  ${title} (empty file)`); continue; }
  if (size > MAX_BYTES) { failed++; console.log(`FAIL  ${title} (${Math.round(size / 1048576)} MB, over the 50 MB limit)`); continue; }
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const t0 = Date.now();
  let itemId = null;
  try {
    const { fileUrl } = await storageService.saveFile(fs.readFileSync(file), path.basename(file), mime);
    const item = await knowledgeService.create(orgId, { clientId, title, type: mime, fileUrl });
    itemId = item.id;
    const r = await embedKnowledgeItem(orgId, item.id);
    imported++;
    console.log(`READ  ${title} | ${r.chunksCreated} chunk(s) | ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${title} | ${String(err?.message || err).slice(0, 140)}${itemId ? ' (kept in the list, marked could not read)' : ''}`);
  }
}
console.log(`\ndone: ${imported} imported, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
