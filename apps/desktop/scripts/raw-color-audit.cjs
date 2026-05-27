#!/usr/bin/env node
/**
 * Raw-color audit — Tailwind color literals like `bg-zinc-500`,
 * `text-amber-300`, `border-white/[0.06]` are forbidden in new code.
 * Use `var(--color-*)` tokens from index.css instead.
 *
 * This script counts current usage and fails if the count exceeds the
 * baseline in `.raw-color-budget.json`. The baseline ratchets DOWN: any
 * PR that reduces the count moves the budget with `--write`. The budget
 * can never go up.
 *
 * Usage:
 *   node scripts/raw-color-audit.cjs           # check (CI mode)
 *   node scripts/raw-color-audit.cjs --write   # update baseline (only after a reduction)
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const BUDGET_FILE = path.resolve(__dirname, '..', '.raw-color-budget.json');

const COLOR_NAMES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

// Match Tailwind utility-color classes inside string literals/className:
//   bg-zinc-500, text-amber-300/70, border-white/[0.06], hover:bg-slate-100
// Skip `white`/`black` neutrals — they're often correct (`text-white` on a colored bg).
const PATTERN = new RegExp(
  // optional variant prefix (hover:, dark:, lg:, group-hover:, etc.)
  '(?:[a-z-]+:)*' +
  // utility class
  '(?:bg|text|border|ring|shadow|from|to|via|outline|decoration|placeholder|accent|caret|fill|stroke|divide)-' +
  // color name
  '(?:' + COLOR_NAMES.join('|') + ')' +
  // tone + optional opacity
  '-\\d{2,3}(?:/\\d{1,3})?',
  'g',
);

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) results.push(full);
  }
  return results;
}

function countInFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const matches = src.match(PATTERN);
  return matches ? matches.length : 0;
}

function main() {
  const files = walk(SRC_DIR);
  const perFile = files.map(f => ({ file: path.relative(SRC_DIR, f), count: countInFile(f) }))
                       .filter(x => x.count > 0)
                       .sort((a, b) => b.count - a.count);
  const total = perFile.reduce((sum, x) => sum + x.count, 0);

  let baseline = null;
  if (fs.existsSync(BUDGET_FILE)) {
    try { baseline = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')); } catch { /* fall through */ }
  }

  const write = process.argv.includes('--write');
  const verbose = process.argv.includes('--verbose');

  if (write) {
    const next = { baseline: total, updated: new Date().toISOString(), topFiles: perFile.slice(0, 10) };
    fs.writeFileSync(BUDGET_FILE, JSON.stringify(next, null, 2) + '\n');
    console.log(`✓ Wrote baseline: ${total} raw color literals`);
    if (baseline?.baseline) {
      const delta = total - baseline.baseline;
      console.log(`  Δ from previous baseline: ${delta > 0 ? '+' : ''}${delta}`);
    }
    process.exit(0);
  }

  if (!baseline) {
    console.error('No .raw-color-budget.json found. Run with --write to create one.');
    process.exit(1);
  }

  console.log(`Raw color literals: ${total} (baseline: ${baseline.baseline})`);
  if (verbose || total > baseline.baseline) {
    console.log('\nTop offenders:');
    for (const { file, count } of perFile.slice(0, 10)) {
      console.log(`  ${count.toString().padStart(4)}  ${file}`);
    }
  }

  if (total > baseline.baseline) {
    const delta = total - baseline.baseline;
    console.error(`\n✗ FAIL — raw color budget exceeded by ${delta}.`);
    console.error('  Use var(--color-*) tokens (see src/index.css) instead of raw Tailwind color classes.');
    console.error('  If this is intentional, run scripts/raw-color-audit.cjs --write to update baseline.');
    process.exit(1);
  }

  if (total < baseline.baseline) {
    console.log(`✓ PASS — reduced by ${baseline.baseline - total}. Run --write to ratchet baseline down.`);
  } else {
    console.log('✓ PASS — baseline unchanged.');
  }
  process.exit(0);
}

main();
