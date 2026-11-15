import { describe, expect, it } from 'vitest';
import { kontrast } from '../test/farbmass';
import { farbenDunkel, farbenHell, rahmenFarben } from './tokens';

/**
 * Farbrolle `uebung` (LLH-1725, Spec `uebungsmarke`, design.md D2), GERECHNET statt behauptet.
 *
 * - Das Wort „ÜBUNG“ steht auf beiden Streifentönen des Bands und auf der Marke: es hält den
 *   Tagesboden 7 : 1 in BEIDEN Modi (das Band hängt am Rahmen, der in beiden Modi dunkel ist).
 * - Der Umriss ist gegen jeden Grund erkennbar, an den Band und Marke stoßen (WCAG 1.4.11,
 *   ≥ 3 : 1): gegen helle Flächen trägt ihn die Füllung, gegen dunkle die Kante.
 */
const TEXTBODEN = 7;
const UMRISSBODEN = 3;

describe.each([
  ['Tag', farbenHell],
  ['Nacht', farbenDunkel],
] as const)('Farbrolle uebung — %s', (_modus, farben) => {
  it.each(['uebungFuellung', 'uebungSchraffur'] as const)('Wort auf %s', (rolle) => {
    expect(kontrast(farben.uebungText, farben[rolle])).toBeGreaterThanOrEqual(TEXTBODEN);
  });

  const nachbarn = {
    'Rahmen (Kopfleiste)': rahmenFarben.grund,
    grund: farben.grund,
    flaeche: farben.flaeche,
    flaeche2: farben.flaeche2,
    paneel: farben.paneel,
    kopf: farben.kopf,
  };

  it.each(Object.entries(nachbarn))('Umriss gegen %s', (_name, nachbar) => {
    const umriss = Math.max(
      kontrast(farben.uebungFuellung, nachbar),
      kontrast(farben.uebungKante, nachbar),
    );
    expect(umriss).toBeGreaterThanOrEqual(UMRISSBODEN);
  });

  it('ist kein Ton einer anderen Bedeutung', () => {
    const andere = [farben.bedien, farben.alarm, farben.achtung, farben.normal, farben.marke];
    for (const ton of [farben.uebungFuellung, farben.uebungSchraffur, farben.uebungKante]) {
      expect(andere).not.toContain(ton);
    }
  });
});
