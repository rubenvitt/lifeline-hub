import { describe, expect, it } from 'vitest';
import { abstand, kontrast } from '../test/farbmass';
import {
  etbTypFarbenDunkel,
  etbTypFarbenHell,
  farbenDunkel,
  farbenHell,
  type EtbTypTon,
} from './tokens';

/**
 * ETB-Typkante, GERECHNET statt behauptet (WCAG-Formel, LLH-1320).
 *
 * Die 2-px-Kante steht an jeder Zeitachsenzeile und an der Erfassungszeile (LLH-1112). Sie ist
 * Zusatzkanal, das Typwort trägt die Aussage (Entscheidung 17.10.2026); als grafisches Element
 * hält sie trotzdem ≥ 3 : 1 (WCAG 1.4.11) gegen beide Böden, auf denen sie steht: `grund`
 * (Zeitachse) und `flaeche2` (Erfassungsleiste). Böden als Literale. Im Browser gemessen in
 * `e2e/hellmodus-kontrast.spec.ts`.
 */

const TYPEN: EtbTypTon[] = [
  'meldung',
  'anordnung',
  'entscheidung',
  'lage',
  'berichtigung',
  'system',
];
const PALETTEN = [
  ['Nacht', etbTypFarbenDunkel, farbenDunkel],
  ['Tag', etbTypFarbenHell, farbenHell],
] as const;

describe('ETB-Typkante — Kontrast gegen den Grund (LLH-1320)', () => {
  for (const [modus, palette, rollen] of PALETTEN) {
    it.each(TYPEN)(`${modus}: Kante „%s“ hält auf grund und flaeche2 ≥ 3 : 1`, (typ) => {
      for (const boden of ['grund', 'flaeche2'] as const) {
        expect(kontrast(palette[typ].kante, rollen[boden]), boden).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('Nacht: die Entscheidungskante liegt über dem alten Wert #722ed1 (2,87 : 1)', () => {
    // Mutationsanker: zurück auf den Entwurfswert macht den Boden oben rot (2,59 auf flaeche2).
    expect(etbTypFarbenDunkel.entscheidung.kante).not.toBe('#722ed1');
    expect(kontrast('#722ed1', farbenDunkel.grund)).toBeLessThan(3);
  });
});

describe('ETB-Typkante — eine Farbe, eine Bedeutung (LLH-1320)', () => {
  /** ΔE (CIE76) ab 30 sind zwei Farben auch als 2-px-Linie nebeneinander klar verschieden. */
  const MIN_ABSTAND = 30;

  it.each(TYPEN.filter((t) => t !== 'entscheidung'))(
    'Nacht: die Entscheidungskante bleibt von Kante und Wort „%s“ getrennt',
    (typ) => {
      const eigene = etbTypFarbenDunkel.entscheidung.kante;
      const fremd = etbTypFarbenDunkel[typ];
      expect(abstand(eigene, fremd.kante), 'Kante').toBeGreaterThanOrEqual(MIN_ABSTAND);
      expect(abstand(eigene, fremd.wort), 'Wort').toBeGreaterThanOrEqual(MIN_ABSTAND);
    },
  );
});
