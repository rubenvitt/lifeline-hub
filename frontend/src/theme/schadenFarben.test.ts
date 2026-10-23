import { describe, expect, it } from 'vitest';
import { kontrast } from '../test/farbmass';
import { farbenDunkel, schadenAusmassFarben } from './tokens';

/**
 * Kartenfarben des Schadenszeichens (LLH-1141, `schadenAusmassFarben`): nachts gegen die dunkle
 * Kartengrundlage und gegen das Paneel des Inspectors gerechnet, WCAG 1.4.11 ≥ 3 : 1. Der Grund
 * der Karte als Literal (`pages/lagekarte/basemapStil.ts`, `FARBEN.dark.hintergrund`), sonst
 * prüfte der Test die Palette gegen sich selbst; dazu der hellste Flächenton der Nachtkarte
 * (`gebaeude`), auf dem ein Schaden in der Stadt meist steht.
 */
const KARTENGRUND_NACHT = ['#0f1115', '#23262b'] as const;

describe('Schadenfarben (LLH-1141)', () => {
  it.each(Object.entries(schadenAusmassFarben))(
    '%s hält nachts ≥ 3 : 1 gegen die Kartengrundlage und das Paneel',
    (_ton, farbe) => {
      for (const grund of [...KARTENGRUND_NACHT, farbenDunkel.paneel]) {
        expect(kontrast(farbe, grund), `${farbe} auf ${grund}`).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it('unterscheidet jedes Ausmaß von jedem anderen (eine Farbe je Stufe)', () => {
    const werte = Object.values(schadenAusmassFarben).map((f) => f.toLowerCase());
    expect(new Set(werte).size).toBe(werte.length);
  });
});
