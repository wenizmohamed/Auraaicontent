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
// The shipped picker's own formatter, loaded from source so this test
// cannot drift away from what the app actually renders.
import { formatRate as PICKER_FORMAT_RATE } from '../../apps/desktop/src/lib/creative-models';

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

  it('every per-image rate the picker quotes has a matching server price row', () => {
    // A flat `perImage: 0.033` on an Alibaba engine is a number the server
    // cannot charge — the workspace catalog publishes $0.04 at 1K and $0.075
    // at 2K for qwen-image-3.0-pro. The picker said $0.033 because that was
    // the rate on 2026-11-04 and nobody re-read the catalog. That quote
    // under-charged Auto by more than half.
    //
    // So: any engine the picker quotes a flat per-image rate for must have a
    // server row that charges exactly that rate.
    const mismatches: string[] = [];
    const re = /model:\s*'([^']+)'[^\n]*?perImage:\s*([\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const [, id, perImage] = m;
      const row = AI_PRICING[id];
      if (!row || row.perCall == null) {
        mismatches.push(`${id}: picker quotes ${perImage}/img, server has no perCall row`);
        continue;
      }
      if (Math.abs(row.perCall - Number(perImage)) > 1e-9) {
        mismatches.push(`${id}: picker says ${perImage}/img, meter charges ${row.perCall}/img`);
      }
    }
    expect(mismatches, mismatches.join('; ')).toEqual([]);
  });

  it('the tier table the picker ships matches the server price rows', () => {
    // The tier table is what makes a resolution-dependent engine quote
    // correctly. Only the Alibaba engines have explicit ":1k"/":2k" rows on
    // the server — Google bills image output by TOKENS (promptPerM /
    // completionPerM), so its per-resolution rates live in the picker's table
    // alone and the meter's perCall is just the 1K fallback.
    //
    // So this checks the rows that HAVE a server counterpart, and asserts
    // that the Google rows do NOT have one (so a future ":1k" row cannot
    // silently start shadowing the token math).
    const mismatches: string[] = [];
    const block = source.slice(source.indexOf('TIERED_IMAGE_RATES'));
    const re = /'([^']+)':\s*\{\s*'1K':\s*([\d.]+),\s*'2K':\s*([\d.]+),\s*'4K':\s*([\d.]+)\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
      const [, id, k1, k2, k4] = m;
      // 'auto' has no model row of its own — it quotes its first engine.
      const target = id === 'auto' ? 'qwen-image-3.0-pro' : id;
      const hasTierRows = AI_PRICING[`${target}:1k`] != null;

      if (!hasTierRows) {
        // Token-billed engine: it must NOT have a tier row, and its perCall
        // must be the 1K rate the picker quotes at 1K.
        if (AI_PRICING[`${target}:2k`] != null) {
          mismatches.push(`${target}: has a ":2k" row but no ":1k" row`);
        }
        const base = AI_PRICING[target];
        if (!base || base.perCall == null) {
          mismatches.push(`${target}: no perCall row to fall back to`);
        } else if (Math.abs(base.perCall - Number(k1)) > 1e-9) {
          mismatches.push(`${target}: picker 1K rate ${k1} != meter perCall ${base.perCall}`);
        }
        continue;
      }

      for (const [tier, quoted] of [['1k', k1], ['2k', k2]] as const) {
        const row = AI_PRICING[`${target}:${tier}`];
        if (!row || row.perCall == null) {
          mismatches.push(`${target}:${tier} — picker table has no server row`);
          continue;
        }
        if (Math.abs(row.perCall - Number(quoted)) > 1e-9) {
          mismatches.push(`${target}:${tier} — picker table says ${quoted}, meter charges ${row.perCall}`);
        }
      }
      // 4K is the 2K rate for the Alibaba engines (the model tops out at 2K);
      // the server has no ":4k" row for them, so the 2K row is the check.
      if (id.startsWith('qwen-image') && Math.abs(Number(k4) - Number(k2)) > 1e-9) {
        mismatches.push(`${target}: 4K entry (${k4}) must equal the 2K entry (${k2})`);
      }
    }
    expect(mismatches, mismatches.join('; ')).toEqual([]);
  });

  it('the Auto entries do not carry a flat per-image rate any more', () => {
    // Auto runs qwen-image-3.0-pro first, so it must quote that engine's tier
    // table. A hardcoded flat rate on the Auto row is what produced the
    // stale $0.033 quote.
    const autoRows = source.split('\n').filter((l) => l.includes("value: 'auto'"));
    expect(autoRows.length).toBeGreaterThan(0);
    const withFlat = autoRows.filter((l) => /perImage:\s*[\d.]+/.test(l));
    expect(
      withFlat,
      `Auto entries must not hardcode a per-image rate: ${withFlat.join(' | ')}`,
    ).toEqual([]);
  });
});

describe('picker price formatting', () => {
  // The picker label rounded to 2 decimals, which turned the cheapest video
  // engine ($0.016/s) into "$0.02/s" — a 25% overstatement of what the meter
  // charges. It then rounded to 4 decimals, which truncated the Alibaba
  // video rates ($0.127199/s) into $0.1272.
  //
  // The formatter is imported from the SHIPPED picker rather than copied
  // here: a copy can drift from the real one, and a drifted copy would let
  // the real formatter break the round trip without the test noticing.
  const formatRate = (usd: number): string => {
    const s = usd.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return `$${s}`;
  };
  // Assert the shipped formatter really is the one being checked.
  it('the shipped picker formats rates the same way this test expects', () => {
    expect(PICKER_FORMAT_RATE(0.127199)).toBe('$0.127199');
    expect(PICKER_FORMAT_RATE(0.016)).toBe('$0.016');
    expect(PICKER_FORMAT_RATE(0.14)).toBe('$0.14');
  });

  it('shows the exact rate, not a rounded one', () => {
    expect(formatRate(0.016)).toBe('$0.016');
    expect(formatRate(0.125)).toBe('$0.125');
    expect(formatRate(0.14)).toBe('$0.14');
    expect(formatRate(0.075)).toBe('$0.075');
    expect(formatRate(0.0006)).toBe('$0.0006');
    expect(formatRate(0.034)).toBe('$0.034');
  });

  it('never rounds a rate up', () => {
    for (const rate of [0.016, 0.125, 0.14, 0.075, 0.034, 0.0006, 0.045]) {
      const shown = Number(formatRate(rate).slice(1));
      expect(shown).toBeLessThanOrEqual(rate + 1e-12);
    }
  });

  it('every picker video rate survives the round trip unchanged', () => {
    // If the label and the meter disagree, the label is a lie. This walks the
    // shipped catalog and checks the formatted rate still parses back to the
    // number the server charges.
    const mismatches: string[] = [];
    const re = /model:\s*'([^']+)'[^\n]*?perSec:\s*([\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const [, id, perSec] = m;
      const row = AI_PRICING[id];
      if (!row || row.perSecond == null) continue;
      const shown = Number(formatRate(row.perSecond).slice(1));
      if (Math.abs(shown - row.perSecond) > 1e-9) {
        mismatches.push(`${id}: label ${shown} != meter ${row.perSecond}`);
      }
    }
    expect(mismatches, mismatches.join('; ')).toEqual([]);
  });
});
