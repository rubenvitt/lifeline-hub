import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kontrast } from '../test/farbmass';
import { farbenDunkel, farbenHell } from './tokens';

/**
 * Fundstellen der Volltextsuche (LFH-1056, `components/Fundstellen.tsx`): `<mark>` auf
 * `achtungFlaeche` mit Unterlinie in `achtung`. Die Fläche allein hebt sich nachts kaum vom
 * Paneel ab; die Linie trägt die Markierung (≥ 3 : 1, WCAG 1.4.11) und unterscheidet sie von der
 * Deeplink-Hervorhebung (ganze Zeile, `bedien`). Text darauf hält den Textboden.
 */
const LINIENBODEN = 3;

const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'index.css'))) return pfad;
  }
  throw new Error(`frontend/src nicht gefunden (cwd: ${process.cwd()})`);
})();

describe('Fundstelle — Regel in index.css', () => {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8');
  const regel = /mark\.lfh-fundstelle\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('liest Fläche und Linie aus den Rollen', () => {
    expect(regel).toMatch(/background-color:\s*var\(--lfh-achtung-flaeche\)/);
    expect(regel).toMatch(/inset 0 -2px 0 var\(--lfh-achtung\)/);
  });

  it('erbt die Textfarbe statt des Browser-Schwarz', () => {
    expect(regel).toMatch(/color:\s*inherit/);
  });
});

describe.each([
  ['Tag', farbenHell, 7],
  ['Nacht', farbenDunkel, 5],
] as const)('Fundstelle — %s', (_modus, farben, textboden) => {
  it.each(['text', 'text2', 'gedaempft', 'schwach'] as const)('%s auf der Fundstelle', (stufe) => {
    expect(kontrast(farben[stufe], farben.achtungFlaeche)).toBeGreaterThanOrEqual(textboden);
  });

  it.each(['achtungFlaeche', 'paneel', 'flaeche', 'bedienFlaeche', 'berichtigungZeile'] as const)(
    'Linie gegen %s',
    (grund) => {
      expect(kontrast(farben.achtung, farben[grund])).toBeGreaterThanOrEqual(LINIENBODEN);
    },
  );
});
