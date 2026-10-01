import { theme as antdTheme } from 'antd';
import { describe, expect, it } from 'vitest';
import { antdAlgorithmus, antdKomponenten, antdToken, farbenDunkel, farbenHell } from './tokens';

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
 * Zeilentext auf der Deeplink-Hervorhebung (LFH-696, Spec `farbrollen-kontrast`, „Zeilentext hält
 * den Textboden auf der Hervorhebung“), gerechnet mit derselben Formel. Der Browser-Nachweis in
 * `e2e/hervorhebung-kontrast.spec.ts` misst nur, was eine Fahrzeugzeile tatsächlich zeigt; die
 * Textrollen der Status deckt erst diese Rechnung ab. Die Textstufen (`text` bis `schwach`) auf
 * der Tönung hält zusätzlich `textstufen.test.ts` (LFH-643).
 */
describe.each([
  ['Tag', farbenHell, 7],
  ['Nacht', farbenDunkel, 5],
] as const)('Zeilentext auf hervorhebungZeile — %s (LFH-696)', (_modus, farben, boden) => {
  it.each([
    'text',
    'text2',
    'gedaempft',
    'bedienText',
    'achtungText',
    'alarmText',
    'normalText',
  ] as const)('%s hält den Textboden', (rolle) => {
    expect(kontrast(farben[rolle], farben.hervorhebungZeile)).toBeGreaterThanOrEqual(boden);
  });
});

/**
 * Der Fokusring (LFH-737): antd zeichnet ihn als `outline` in `colorPrimaryBorder`
 * (`genFocusOutline`, auch Upload-Dragger), und das leitet die Palette aus `bedien` als
 * HELLE Stufe ab: Tag 2,57–3,28, Nacht 1,51–1,70 gegen die Flächen, unter dem Boden aus
 * Kriterium 5 (WCAG 1.4.11, ≥ 3 : 1). Der Ring trägt deshalb die Rolle `bedien`, wie die eigenen
 * Klassen in `sprache.css` (`--lfh-bedien`). Geprüft wird der AUFGELÖSTE Token mit dem echten
 * Algorithmus je Modus; der Boden steht als Literal. Browser-Nachweis:
 * `e2e/fokusring-kontrast.spec.ts`.
 */
describe.each([
  ['Tag', farbenHell, false],
  ['Nacht', farbenDunkel, true],
] as const)('Fokusring — %s (LFH-737)', (_modus, farben, dunkel) => {
  const aufgeloest = () =>
    antdTheme.getDesignToken({ token: antdToken(farben), algorithm: antdAlgorithmus(dunkel) });

  it('antds Fokusumriss trägt die Rolle bedien', () => {
    expect(aufgeloest().colorPrimaryBorder).toBe(farben.bedien);
  });

  // Jede DECKENDE Fläche, auf der ein Bedienziel stehen kann; Füllungen mit Alpha sind keine.
  it.each([
    'grund',
    'flaeche',
    'flaeche2',
    'kopf',
    'paneel',
    'flaeche3',
    'normalFlaeche',
    'achtungFlaeche',
    'alarmFlaeche',
    'bedienFlaeche',
    'bannerGrund',
  ] as const)('der Ring hält auf %s ≥ 3 : 1', (flaeche) => {
    expect(kontrast(aufgeloest().colorPrimaryBorder, farben[flaeche])).toBeGreaterThanOrEqual(3);
  });

  // `colorPrimaryBorder` ist auch die Ruhefarbe von Spur und Griff des Schiebereglers; antd
  // färbt den Griff unter dem Zeiger in `colorPrimary` = `bedien`, die Spur in der abgeleiteten
  // Hover-Stufe (nachts DUNKLER als `bedien`). Beide nehmen `bedienHover` wie der Primärknopf.
  it('der Schieberegler zeigt den Zeiger in bedienHover, nicht in seiner Ruhefarbe', () => {
    expect(antdKomponenten(farben, 'kompakt').Slider).toMatchObject({
      trackHoverBg: farben.bedienHover,
      handleActiveColor: farben.bedienHover,
    });
    expect(farben.bedienHover).not.toBe(aufgeloest().colorPrimaryBorder);
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
