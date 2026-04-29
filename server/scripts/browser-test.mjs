// Real browser test: load dashboard + brief in light + dark mode, screenshot, find console errors.
import { chromium } from 'playwright';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const BASE = 'https://srv1494206.hstgr.cloud';
// Use a REAL user from the DB so /api/auth/me returns 200 instead of 404.
// Mohamed Sidahmed is the original founder account.
const TOKEN = jwt.sign(
  { userId: 'cmnx7smux0000kz6xb5rggozd', email: 'mohamed.sidahmed@radixmediamena.com' },
  process.env.JWT_SECRET,
  { expiresIn: '15m' },
);

const pages = [
  { path: '/', name: 'dashboard' },
  { path: '/brief', name: 'brief' },
  { path: '/gallery', name: 'gallery' },
  { path: '/calendar', name: 'calendar' },
  { path: '/clients', name: 'clients' },
];

const results = { pass: 0, fail: 0, errors: [] };
const ok = (msg) => { console.log('  ✓', msg); results.pass++; };
const bad = (msg, detail) => { console.log('  ✗', msg, '--', detail); results.fail++; results.errors.push(`${msg}: ${detail}`); };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});

// Inject auth token into localStorage before any page loads
await ctx.addInitScript((tok) => {
  localStorage.setItem('radix_auth_token', tok);
}, TOKEN);

for (const theme of ['dark', 'light']) {
  console.log(`\n──── ${theme.toUpperCase()} mode ────`);
  for (const p of pages) {
    const page = await ctx.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} -- ${req.failure()?.errorText}`);
    });
    // Capture all 4xx/5xx responses with URL detail
    const httpErrors = [];
    page.on('response', (resp) => {
      if (resp.status() >= 400) httpErrors.push(`${resp.status()} ${resp.url()}`);
    });

    try {
      await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle', timeout: 20000 });
      // Set theme
      await page.evaluate((t) => {
        localStorage.setItem('radix_theme', t);
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(t);
      }, theme);
      await page.waitForTimeout(800); // let theme apply
      // Screenshot
      const fname = `/tmp/radix-${p.name}-${theme}.png`;
      await page.screenshot({ path: fname, fullPage: true });
      // Body text length sanity + root content
      const bodyText = await page.evaluate(() => document.body.innerText.length);
      const rootHTML = await page.evaluate(() => document.getElementById('root')?.innerHTML?.length || 0);
      if (bodyText > 100 && rootHTML > 50) ok(`${p.path} React mounted (${bodyText} chars, root=${rootHTML}b, screenshot ${fname})`);
      else bad(`${p.path}`, `React not mounted: body=${bodyText}c root=${rootHTML}b`);
      // Print HTTP errors so we know what's missing
      if (httpErrors.length > 0) console.log(`     HTTP errors:`, httpErrors.slice(0, 5).join(' | '));

      if (consoleErrors.length > 0) {
        // Filter noise
        const real = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('manifest'));
        if (real.length > 0) bad(`${p.path} console errors`, real.slice(0, 3).join(' | '));
      }
      if (failedRequests.length > 0) {
        const real = failedRequests.filter(r => !r.includes('favicon'));
        if (real.length > 0) bad(`${p.path} failed requests`, real.slice(0, 3).join(' | '));
      }
    } catch (err) {
      bad(`${p.path}`, err.message);
    } finally {
      await page.close();
    }
  }
}

await browser.close();
console.log('\n════════════════════════════════════════');
console.log(`  Results: ${results.pass} passed, ${results.fail} failed`);
console.log('════════════════════════════════════════');
if (results.fail > 0) {
  console.log('Errors:');
  for (const e of results.errors) console.log('  -', e);
  process.exit(1);
}
