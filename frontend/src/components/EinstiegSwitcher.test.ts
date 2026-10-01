/**
 * Der Kopf-Wechsler eines Orts-Moduls ist ein Bedienziel (LFH-724): `height: auto` ließ ihn auf
 * die Schrift schrumpfen, gemessen 33 px in `handschuh`. Böden als LITERALE (30 / 48 / 72); die
 * gerenderte Höhe misst `e2e/trefflaeche-pruefflaechen.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { wechslerStil } from './EinstiegSwitcher';

describe('EinstiegSwitcher — Trefffläche des Wechslers (LFH-724)', () => {
  for (const [controlHeight, boden] of [
    [30, 30],
    [48, 48],
    [72, 72],
  ] as const) {
    it(`Steuerhöhe ${controlHeight}: der Wechsler ist mindestens ${boden} px hoch`, () => {
      expect(wechslerStil({ controlHeight }).minHeight).toBe(boden);
    });
  }

  it('behält die Optik des Titels: kein Innenabstand, Höhe folgt dem Inhalt', () => {
    expect(wechslerStil({ controlHeight: 72 })).toMatchObject({ padding: 0, height: 'auto' });
  });
});
