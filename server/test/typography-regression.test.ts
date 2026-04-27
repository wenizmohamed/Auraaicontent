import { describe, it, expect } from 'vitest';

const BASE = process.env.SMOKE_BASE_URL ?? 'https://srv1494206.hstgr.cloud';

// Pin the typography swap shipped in commit 4d5c95d (Libre Bodoni + Public Sans).
// If a future build drops the @import or the @theme tokens, this gate fires
// before the bundle hits prod (via the prod-smoke workflow).
describe('regression: typography swap (P6)', () => {
  async function getStylesheet() {
    const html = await (await fetch(BASE)).text();
    const m = html.match(/index-[A-Za-z0-9_-]+\.css/);
    if (!m) throw new Error(`no index-*.css link found in ${BASE}/`);
    return await (await fetch(`${BASE}/assets/${m[0]}`)).text();
  }

  it('shipped CSS contains Libre Bodoni + Public Sans declarations', async () => {
    const css = await getStylesheet();
    expect(css).toContain('Libre Bodoni');
    expect(css).toContain('Public Sans');
  });

  it('--font-sans token is Public Sans, --font-display is Libre Bodoni', async () => {
    const css = await getStylesheet();
    expect(css).toMatch(/--font-sans:\s*"?Public Sans/);
    expect(css).toMatch(/--font-display:\s*"?Libre Bodoni/);
  });

  it('Google Fonts import loads with display=swap (no FOIT)', async () => {
    const css = await getStylesheet();
    expect(css).toMatch(/fonts\.googleapis\.com.*display=swap/);
  });
});
