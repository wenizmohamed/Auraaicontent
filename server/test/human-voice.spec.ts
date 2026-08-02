// Tests for the de-AI text sanitiser (src/lib/human-voice.ts).
//
// deAiText() is the enforcement layer behind HUMAN_VOICE_RULE: even when a
// model ignores the prompt directive, no em dash or en dash may survive into
// user-facing copy. These tests pin the replacement rules:
//   * clause dash -> full stop + capitalised next word
//   * dash before a continuation word (including, with, plus, via, e.g.) -> comma
//   * no double punctuation after ? / !
//   * hyphenated words and dash-free text untouched
//   * idempotent, and deAiDeep() walks objects/arrays
//
// Project standard: no literal em dashes in source strings, so fixtures build
// them from escapes.
//
// Run:  npx vitest run test/human-voice.spec.ts

import { describe, expect, it } from 'vitest';
import { deAiText, deAiDeep } from '../src/lib/human-voice.js';

const EM = '\u2014'; // em dash, built from escape per project no-dash standard
const EN = '\u2013'; // en dash
const DASH = /[\u2013\u2014]/;

// Realistic caption fixtures, the kind of copy the generators actually emit.
const CAPTION_FIXTURES: string[] = [
  `New drop just landed ${EM} shop the collection before it sells out`,
  `Weekend brunch is back ${EN} reserve your table now`,
  `Our biggest sale of the year ${EM} up to 50% off everything`,
  `Fresh flavors, zero guilt ${EM} including vegan options`,
  `Ready? ${EM} tap the link in bio`,
  `Skincare that works ${EM} no filters needed`,
  `Doha to Dubai ${EM} daily flights from QAR 499`,
  `The all-new espresso bar ${EM} now open in City Centre`,
  `Limited seats ${EM} e.g. Friday sessions fill fast`,
  `Iftar boxes for the whole family ${EM} from AED 99`,
  `Behind the scenes ${EM} our team packs every order by hand`,
  `Delivered in 2${EN}3 business days`,
  `${EM} Fresh daily drop`,
  `Order before midnight ${EM}`,
];

// Dash-free strings that must come back byte-identical.
const DASH_FREE_FIXTURES: string[] = [
  'image-to-video is live for every client',
  'A well-known cafe in West Bay',
  'Ships in 2-3 business days, free returns',
  'Plain caption with no dashes at all.',
  '',
];

describe('deAiText: clause-separating em dash', () => {
  it('replaces the dash with a full stop and capitalises the next word', () => {
    expect(deAiText(`The launch sold out ${EM} orders reopen Friday`)).toBe(
      'The launch sold out. Orders reopen Friday',
    );
  });

  it('keeps brand-style casing intact when the next word is not plain lowercase', () => {
    expect(deAiText(`All models supported ${EM} iPhone included`)).toBe(
      'All models supported. iPhone included',
    );
  });
});

describe('deAiText: continuation words get a comma, not a full stop', () => {
  const cases: Array<[string, string]> = [
    [`Fresh flavors, zero guilt ${EM} including vegan options`, 'Fresh flavors, zero guilt, including vegan options'],
    [`Two sizes available ${EM} with gift wrap on request`, 'Two sizes available, with gift wrap on request'],
    [`Fast setup ${EM} plus free onboarding`, 'Fast setup, plus free onboarding'],
    [`Book your slot ${EM} via the app`, 'Book your slot, via the app'],
    [`Great for gifting ${EM} e.g. birthdays and Eid`, 'Great for gifting, e.g. birthdays and Eid'],
    [`Iftar boxes for the whole family ${EM} from AED 99`, 'Iftar boxes for the whole family, from AED 99'],
    [`Our biggest sale of the year ${EM} up to 50% off everything`, 'Our biggest sale of the year, up to 50% off everything'],
  ];

  for (const [input, expected] of cases) {
    it(`comma before "${expected.split(', ').pop()}"`, () => {
      expect(deAiText(input)).toBe(expected);
    });
  }

  it('does NOT treat lookalike words (orders, no) as continuations', () => {
    // "or\b" must not match "orders"; "not\b" must not match "no".
    expect(deAiText(`The launch sold out ${EM} orders reopen Friday`)).toBe(
      'The launch sold out. Orders reopen Friday',
    );
    expect(deAiText(`Skincare that works ${EM} no filters needed`)).toBe(
      'Skincare that works. No filters needed',
    );
  });
});

describe('deAiText: no double punctuation after ? or !', () => {
  it('question mark before the dash: just a space, next word capitalised', () => {
    const out = deAiText(`Ready? ${EM} tap the link in bio`);
    expect(out).toBe('Ready? Tap the link in bio');
    expect(out).not.toMatch(/[?!]\s*\./);
  });

  it('exclamation mark before the dash: just a space, next word capitalised', () => {
    const out = deAiText(`What a launch! ${EM} thank you Doha`);
    expect(out).toBe('What a launch! Thank you Doha');
    expect(out).not.toMatch(/[?!]\s*\./);
  });
});

describe('deAiText: hyphenated words are untouched', () => {
  it('leaves pure-hyphen text byte-identical', () => {
    const s = 'image-to-video, well-known brands, 2-3 day delivery';
    expect(deAiText(s)).toBe(s);
  });

  it('preserves hyphens inside a sentence that also has an em dash', () => {
    expect(deAiText(`Our image-to-video tool ${EM} well-known for speed`)).toBe(
      'Our image-to-video tool. Well-known for speed',
    );
  });
});

describe('deAiText: dash-free text is byte-identical', () => {
  for (const s of DASH_FREE_FIXTURES) {
    it(`identity for ${JSON.stringify(s)}`, () => {
      expect(deAiText(s)).toBe(s);
    });
  }
});

describe('deAiText: en dashes are handled like em dashes', () => {
  it('clause-separating en dash becomes a full stop + capital', () => {
    expect(deAiText(`Weekend brunch is back ${EN} reserve your table now`)).toBe(
      'Weekend brunch is back. Reserve your table now',
    );
  });

  it('en dash before a continuation word becomes a comma', () => {
    expect(deAiText(`Open all week ${EN} including Fridays`)).toBe(
      'Open all week, including Fridays',
    );
  });
});

describe('deAiText: never leaves an em dash or en dash in the output', () => {
  for (const s of CAPTION_FIXTURES) {
    it(`clean output for ${JSON.stringify(s)}`, () => {
      expect(deAiText(s)).not.toMatch(DASH);
    });
  }

  it('drops a leading dash entirely', () => {
    expect(deAiText(`${EM} Fresh daily drop`)).toBe('Fresh daily drop');
  });

  it('drops a trailing dash entirely', () => {
    expect(deAiText(`Order before midnight ${EM}`)).toBe('Order before midnight');
  });
});

describe('deAiText: idempotence', () => {
  const all = [...CAPTION_FIXTURES, ...DASH_FREE_FIXTURES];
  for (const s of all) {
    it(`stable after second pass for ${JSON.stringify(s)}`, () => {
      const once = deAiText(s);
      expect(deAiText(once)).toBe(once);
    });
  }
});

describe('deAiDeep: recursive cleaning', () => {
  it('cleans strings nested in objects and arrays, leaves non-strings untouched', () => {
    const input = {
      caption: `New drop ${EM} shop now`,
      count: 7,
      live: true,
      missing: null,
      tags: [`clean look ${EM} zero clutter`, 3, false],
      nested: { note: `Open late ${EN} until 2am`, depth: [{ inner: `Ready? ${EM} go` }] },
    };
    const out = deAiDeep(input);
    expect(out).toEqual({
      caption: 'New drop. Shop now',
      count: 7,
      live: true,
      missing: null,
      tags: ['clean look. Zero clutter', 3, false],
      nested: { note: 'Open late. Until 2am', depth: [{ inner: 'Ready? Go' }] },
    });
    expect(JSON.stringify(out)).not.toMatch(DASH);
  });

  it('does not mutate the original object', () => {
    const input = { caption: `New drop ${EM} shop now` };
    deAiDeep(input);
    expect(input.caption).toBe(`New drop ${EM} shop now`);
  });

  it('passes primitives straight through', () => {
    expect(deAiDeep(42)).toBe(42);
    expect(deAiDeep(null)).toBe(null);
    expect(deAiDeep(true)).toBe(true);
    expect(deAiDeep(undefined)).toBe(undefined);
  });
});
