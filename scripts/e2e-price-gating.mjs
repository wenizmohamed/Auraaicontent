#!/usr/bin/env node
/**
 * Browser regression test for price visibility.
 *
 * Prices, per-second rates and spend totals are for OWNER, ADMIN and anyone in
 * ACCOUNTING_EMAILS only. Everyone else must never see a cost figure. That rule is
 * enforced server-side (lib/pricing-visibility.ts + a 403 on /api/dashboard/usage)
 * and unit-tested there, but the thing users actually experience is the rendered
 * page, so this walks a real browser through both personas and asserts on the DOM.
 *
 * Deliberately dependency-free for the repo: it uses the GLOBAL playwright install
 * (/usr/lib/node_modules) rather than adding a devDependency, because adding one to
 * a workspace package requires an npm install at the repo root and would churn the
 * shared lockfile that every CI job runs `npm ci` against.
 *
 * Run on the server (it mints tokens with the local JWT secret):
 *   node scripts/e2e-price-gating.mjs
 *   PROD_DIR=/opt/radix-v2/server BASE=https://radixcontent.com node scripts/e2e-price-gating.mjs
 *
 * Exits 0 when every assertion passes, 1 on the first failure.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('/usr/lib/node_modules/');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright not resolvable. Install it globally: npm i -g playwright');
  process.exit(1);
}

const PROD_DIR = process.env.PROD_DIR || '/opt/radix-v2/server';
const BASE = process.env.BASE || 'https://radixcontent.com';
const ORG = process.env.E2E_ORG_ID || 'org_radix_media';

/** Mint a JWT with the server's own signer so the test uses real auth. */
function mintToken({ userId, email, role, orgRole }) {
  const code = `const {signToken}=require('./dist/middleware/auth.js');`
    + `console.log(signToken(${JSON.stringify({ userId, email, role, orgId: ORG, orgRole })}))`;
  return execFileSync('node', ['--env-file=.env', '-e', code], { cwd: PROD_DIR, encoding: 'utf8' }).trim();
}

/** Look up a real member of the org with the given role, so the test is not hypothetical. */
function findMember(orgRole) {
  const sql = `SELECT u.id || '|' || u.email FROM "User" u `
    + `JOIN "OrgMembership" m ON m."userId" = u.id `
    + `WHERE m.role = '${orgRole}' AND m."orgId" = '${ORG}' LIMIT 1;`;
  const dbUrl = execFileSync('bash', ['-c', `grep '^DATABASE_URL=' ${PROD_DIR}/.env | cut -d= -f2- | tr -d '"'`], { encoding: 'utf8' }).trim();
  const out = execFileSync('psql', [dbUrl, '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();
  if (!out) return null;
  const [id, email] = out.split('|');
  return { id, email };
}

const failures = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
    failures.push(name);
  }
}

/**
 * Everything a price could look like on screen. Built fresh per use: a /g regex
 * keeps lastIndex between .test() calls, which silently flips results.
 */
const priceRe = () => /\$\s?\d[\d.,]*|\d+\s*(?:USD|usd)\b/g;
const pricesIn = (text) => text.match(priceRe()) || [];

async function inspectAs(browser, label, token) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  // Seed auth via an init script so it lands BEFORE any app code runs. Setting
  // localStorage after a goto lets the app boot unauthenticated, clear the token
  // and drop to the login screen, which would make every "sees no price"
  // assertion below pass for the wrong reason.
  await context.addInitScript((t) => {
    try { localStorage.setItem('radix_auth_token', t); } catch { /* private mode */ }
  }, token);
  const page = await context.newPage();

  const seen = {};
  for (const [surface, path] of [['creative', '/creative?tab=text-to-video'], ['dashboard', '/dashboard']]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500); // let the SPA settle and the usage query resolve
    seen[surface] = await page.evaluate(() => {
      const text = document.body.innerText;
      const tooltips = Array.from(document.querySelectorAll('[title]'))
        .map((el) => el.getAttribute('title') || '')
        .join(' | ');
      return {
        text,
        tooltips,
        // Proof the app actually rendered for a signed-in user. Without this a
        // login screen would satisfy every negative assertion.
        authenticated: !/Sign in to your content workspace|Welcome back\./i.test(text),
        usageMeter: Array.from(document.querySelectorAll('*')).some(
          (el) => /this month/i.test(el.textContent || '') && (el.textContent || '').includes('$'),
        ),
      };
    });
  }

  await context.close();
  return seen;
}

/** A negative assertion is only meaningful once the app is proven to be signed in. */
function requireAuthenticated(persona, seen) {
  for (const surface of Object.keys(seen)) {
    check(`${persona} is authenticated on ${surface}`, seen[surface].authenticated,
      'rendered the login screen, so any "no price" result below would be vacuous');
  }
}

(async () => {
  console.log(`Price-gating browser check against ${BASE}\n`);

  const editor = findMember('EDITOR');
  if (!editor) {
    console.error(`No EDITOR member found in ${ORG}; cannot run the negative case.`);
    process.exit(1);
  }

  const browser = await chromium.launch({
    // Browser equivalent of curl --resolve: test the local nginx even when public
    // DNS for the apex is not reachable from this box.
    args: [`--host-resolver-rules=MAP ${new URL(BASE).hostname} 127.0.0.1`],
  });

  try {
    console.log('OWNER (must SEE prices)');
    const ownerToken = mintToken({
      userId: process.env.E2E_OWNER_ID || 'cmnx84r0i0000kzc1w30vij0k',
      email: process.env.E2E_OWNER_EMAIL || 'weni.mohamed@gmail.com',
      role: 'ADMIN', orgRole: 'OWNER',
    });
    const owner = await inspectAs(browser, 'owner', ownerToken);
    requireAuthenticated('owner', owner);
    check('owner sees a price on Creative Tools',
      pricesIn(owner.creative.text).length > 0 || /\$/.test(owner.creative.tooltips),
      'no price string found');
    check('owner sees the usage meter', owner.dashboard.usageMeter || owner.creative.usageMeter);

    console.log(`\nEDITOR ${editor.email} (must see NO prices)`);
    const editorToken = mintToken({ userId: editor.id, email: editor.email, role: 'USER', orgRole: 'EDITOR' });
    const ed = await inspectAs(browser, 'editor', editorToken);
    requireAuthenticated('editor', ed);

    for (const surface of ['creative', 'dashboard']) {
      const found = pricesIn(ed[surface].text);
      check(`editor sees no price on ${surface}`, found.length === 0, `found ${JSON.stringify(found.slice(0, 5))}`);
    }
    check('editor sees no rate in engine tooltips', !/\$/.test(ed.creative.tooltips), ed.creative.tooltips.slice(0, 120));
    check('editor sees no usage meter', !ed.creative.usageMeter && !ed.dashboard.usageMeter);
    check('editor sees no "Est. cost" tile', !/est\.?\s*cost/i.test(ed.dashboard.text));

    // The copy rule rides along: nothing user-facing may render an em dash.
    console.log('\nCOPY (no AI-tell punctuation in rendered UI)');
    for (const surface of ['creative', 'dashboard']) {
      const dashes = (ed[surface].text.match(/—/g) || []).length;
      check(`no em dash rendered on ${surface}`, dashes === 0, `${dashes} found`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('e2e run failed:', err?.message || err);
  process.exit(1);
});
