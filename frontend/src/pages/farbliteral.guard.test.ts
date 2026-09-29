import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Kein `#888` in `pages/` (LFH-347): Farbwerte kommen aus `theme.useToken()` /
 * `theme/statusFarben.ts`; das Literal verlor im Dunkelmodus Kontrast. Bewusst nur dieses Literal —
 * ein Gate gegen jedes Hex-Literal wäre rot geboren (`flaechenFarbe` u. a. tragen begründete
 * Werte).
 */
function dateien(verz: string): string[] {
  return readdirSync(verz).flatMap((n) => {
    const p = join(verz, n);
    if (statSync(p).isDirectory()) return dateien(p);
    return /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}

describe('Farbliteral-Gate', () => {
  it('kennt kein #888 in pages/', () => {
    const treffer = dateien(join(__dirname))
      .filter((p) => !p.endsWith('farbliteral.guard.test.ts'))
      .filter((p) => readFileSync(p, 'utf8').includes('#888'));
    expect(treffer).toEqual([]);
  });
});
