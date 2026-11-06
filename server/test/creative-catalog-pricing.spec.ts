// The Creative Studio picker and the cost meter must agree.
//
// A model that appears in the picker but has no row in AI_PRICING bills $0
// on every generation — the cost dashboard under-reports and the org is
// never charged for the work it consumed. The boot guard cannot catch this
// because it only audits *_MODEL env vars; the picker catalog is a hand-
// maintained list in the DESKTOP package.
//
// So this test reads the shipped picker catalog and asserts every engine it
// offers is priced on the server side.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AI_PRICING, isPriced } from '../src/lib/ai-pricing';

const CATALOG = resolve(__dirname, '../../apps/desktop/src/lib/creative-models.ts');
const source = readFileSync(CATALOG, 'utf8');

/** Every `model: 'x'` id the picker sends to the server. */
function pickerModelIds(): string[] {
  const ids = new Set<string>();
  const re = /\bmodel:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) ids.add(m[1]);
  return [...ids];
}

describe('picker catalog and cost meter agree', () => {
  const ids = pickerModelIds();

  it('the catalog declares model ids', () => {
    expect(ids.length).toBeGreaterThan(5);
  });

  it('every engine the picker offers has a price row on the server', () => {
    const unpriced = ids.filter((id) => !isPriced(id));
    expect(
      unpriced,
      `these picker engines would bill $0: ${unpriced.join(', ')}`,
    ).toEqual([]);
  });

  it('the picker never offers a DashScope-bound engine the server cannot route', () => {
    // A foreign id (a Gemini/Grok id, or a typo) forwarded to DashScope is a
    // 404 "Model not exist" that kills the whole chain. Only DashScope-shaped
    // ids may be sent as an explicit Alibaba pick.
    //
    // Gemini and Grok entries carry their own `provider`, so they are routed
    // to their own provider and never reach DashScope. Video entries carry no
    // provider at all — the server picks the provider from the id — so their
    // ids must be one the provider recognises.
    const alibabaIds = ids.filter((id) => !/^(gemini|veo|omni|grok|nano-banana|imagen)/i.test(id));
    const foreign = alibabaIds.filter(
      (id) => !/^(qwen-image|z-image|wan[\d.]+-image|wan[\d.]+-(video|t2v|i2v|r2v|videoedit)|happyhorse-[\d.]+-(t2v|i2v|r2v|video-edit)|vidu\/)/i.test(id),
    );
    expect(
      foreign,
      `these picker engines are not DashScope-shaped and would 404: ${foreign.join(', ')}`,
    ).toEqual([]);
  });

  it('the quoted per-second rate matches the server price row', () => {
    // The picker shows the user a rate; the meter charges another. They have
    // to be the same number or the quoted price is a lie.
    const mismatches: string[] = [];
    // Each video entry: model: 'x', ... perSec: 0.14, perSec1080: 0.28
    const re = /model:\s*'([^']+)'[^\n]*?perSec:\s*([\d.]+)(?:,\s*perSec1080:\s*([\d.]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const [, id, perSec, perSec1080] = m;
      const row = AI_PRICING[id];
      if (!row || row.perSecond == null) { mismatches.push(`${id}: no perSecond price row`); continue; }
      if (Math.abs(row.perSecond - Number(perSec)) > 1e-9) {
        mismatches.push(`${id}: picker says ${perSec}/s, meter charges ${row.perSecond}/s`);
      }
      if (perSec1080 && Math.abs((row.perSecond * 1.25) - Number(perSec1080)) > 0.001
          && Math.abs(row.perSecond - Number(perSec1080)) > 1e-9) {
        // The 1080p rate is a DIFFERENT row (":1080p"), not a multiplier.
        const hi = AI_PRICING[`${id}:1080p`];
        if (!hi || hi.perSecond == null || Math.abs(hi.perSecond - Number(perSec1080)) > 1e-9) {
          mismatches.push(`${id}: picker says ${perSec1080}/s at 1080p, meter row does not match`);
        }
      }
    }
    expect(mismatches, mismatches.join('; ')).toEqual([]);
  });
});
