import { describe, expect, it } from 'vitest';
import { farbenDunkel, farbenHell } from './tokens';

/**
 * Beschriftung auf satter Bedienfläche (Primärknopf), GERECHNET statt behauptet (WCAG-Formel).
 *
 * Kein eigener Knopfboden (LFH-661, Spec `farbrollen-kontrast`): die Beschriftung hält den
 * Textboden aus Kriterium 5, Tag ≥ 7 : 1, Nacht ≥ 5 : 1, in Ruhe UND unter dem Zeiger. Ein
 * Großtext-Boden trägt nicht: die Knopfschrift misst 13,5 bis 16 px (großer Knopf), WCAG verlangt
 * für fetten Großtext 18,66 px. Böden als Literale; der Browser-Nachweis steht in
 * `e2e/primaerknopf-kontrast.spec.ts`.
 */
function luminanz(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function kontrast(a: string, b: string): number {
  const [x, y] = [luminanz(a), luminanz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe.each([
  ['Tag', farbenHell, 7],
  ['Nacht', farbenDunkel, 5],
] as const)('Primärknopf — %s (LFH-661)', (_modus, farben, boden) => {
  it.each(['bedien', 'bedienHover'] as const)('aufBedien auf %s hält den Textboden', (flaeche) => {
    expect(kontrast(farben.aufBedien, farben[flaeche])).toBeGreaterThanOrEqual(boden);
  });

  it('die Fläche unter dem Zeiger unterscheidet sich von der Ruhe', () => {
    expect(farben.bedienHover.toLowerCase()).not.toBe(farben.bedien.toLowerCase());
  });
});

/**
 * Text auf jeder Flächenstufe (LFH-702/LFH-877, Spec `textkontrast-rollen`): `bedienText` (Link)
 * und `gedaempft` (Beschreibung, Tabellenkopf, „—") halten den Textboden auch auf der
 * Hervorhebungsfläche `flaeche3` (Hover- und Aktivzeile). Gemessen im Browser in
 * `e2e/dokumente.spec.ts` und `e2e/betroffene-kontrast.spec.ts`.
 */
describe.each([
  ['Tag', farbenHell, 7],
  ['Nacht', farbenDunkel, 5],
] as const)('Textrollen auf jeder Flächenstufe — %s (LFH-702/LFH-877)', (_modus, farben, boden) => {
  const flaechen = [
    'grund',
    'flaeche',
    'flaeche2',
    'kopf',
    'paneel',
    'flaeche3',
    'bedienFlaeche',
  ] as const;
  it.each(['bedienText', 'gedaempft'] as const)('%s hält den Textboden', (rolle) => {
    for (const flaeche of flaechen) {
      expect(
        kontrast(farben[rolle], farben[flaeche]),
        `${rolle} auf ${flaeche}`,
      ).toBeGreaterThanOrEqual(boden);
    }
  });
});
