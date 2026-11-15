import { describe, expect, it } from 'vitest';
import { kontrast } from '../test/farbmass';
import {
  etbTypFarbenDunkel,
  etbTypFarbenHell,
  farbenDunkel,
  farbenHell,
  rahmenFarben,
} from './tokens';

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
  ['Tag', farbenHell, etbTypFarbenHell],
  ['Nacht', farbenDunkel, etbTypFarbenDunkel],
] as const)('Farbrolle uebung — %s', (_modus, farben, etbTyp) => {
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

  // Violette Kennfarben gibt es schon (ETB-Entscheidung, KRITIS-Ebene); die Übung teilt keinen Ton
  // mit ihnen und hebt sich durch Fläche und Wort ab (design.md, Risiken).
  it('teilt keinen Ton mit einer Status- oder ETB-Typfarbe', () => {
    const andere = [
      farben.bedien,
      farben.alarm,
      farben.achtung,
      farben.normal,
      farben.marke,
      ...Object.values(etbTyp).flatMap((t) => [t.kante, t.wort]),
    ];
    for (const ton of [farben.uebungFuellung, farben.uebungSchraffur, farben.uebungKante]) {
      expect(andere).not.toContain(ton);
    }
  });
});
