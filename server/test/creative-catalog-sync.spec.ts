import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCatalogSource } from '../../scripts/gen-creative-catalog';

// AURA assigns from exactly the models the user can pick. The server's copy is
// generated from the picker; this fails when the picker changed without a
// regenerate (npx tsx scripts/gen-creative-catalog.ts).
describe('creative catalog: AURA and the picker share one list', () => {
  it('creative-catalog.generated.ts matches the picker', () => {
    const committed = readFileSync(resolve(__dirname, '../src/services/creative-catalog.generated.ts'), 'utf8');
    expect(committed).toBe(buildCatalogSource());
  });
});
