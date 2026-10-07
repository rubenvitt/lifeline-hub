import { describe, expect, it } from 'vitest';
import { berechneAusschnitt, type AusschnittEingabe } from './fensterAusschnitt';

const basis = (teil: Partial<AusschnittEingabe>): AusschnittEingabe => ({
  hoehen: Array.from({ length: 1000 }, () => undefined),
  schaetzung: 50,
  sichtVon: 0,
  sichtBis: 500,
  ueberhang: 100,
  anker: null,
  ...teil,
});

describe('berechneAusschnitt (LFH-949)', () => {
  it('nimmt am Anfang den Sichtbereich plus Überhang, die Platzhalter tragen den Rest', () => {
    const a = berechneAusschnitt(basis({}));
    // 0 … 600 px bei 50 px je Zeile: Zeilen 0–11.
    expect(a).toEqual({ von: 0, bis: 12, oben: 0, unten: (1000 - 12) * 50, gesamt: 50_000 });
  });

  it('schneidet in der Mitte mit Überhang auf beiden Seiten', () => {
    const a = berechneAusschnitt(basis({ sichtVon: 10_000, sichtBis: 10_500 }));
    // 9 900 … 10 600 px: erste Zeile endet über 9 900 → 198, letzte beginnt unter 10 600 → 211.
    expect(a.von).toBe(198);
    expect(a.bis).toBe(212);
    expect(a.oben).toBe(198 * 50);
    expect(a.oben + (a.bis - a.von) * 50 + a.unten).toBe(a.gesamt);
  });

  it('hinter dem Ende bleiben die letzten Zeilen stehen', () => {
    const a = berechneAusschnitt(basis({ sichtVon: 80_000, sichtBis: 80_500 }));
    expect(a.bis).toBe(1000);
    expect(a.von).toBeLessThan(1000);
    expect(a.unten).toBe(0);
  });

  it('gemessene Höhen zählen, eine Messung von 0 gilt als nicht gemessen', () => {
    const hoehen = Array.from({ length: 1000 }, (_, i) =>
      i < 10 ? 100 : i === 10 ? 0 : undefined,
    );
    const a = berechneAusschnitt(basis({ hoehen, sichtVon: 1000, sichtBis: 1100, ueberhang: 0 }));
    // 10 Zeilen à 100 px = 1 000 px; Zeile 10 (Messung 0) geschätzt mit 50.
    expect(a.von).toBe(10);
    expect(a.oben).toBe(1000);
    expect(a.bis).toBe(12);
    expect(a.gesamt).toBe(1000 + 990 * 50);
  });

  it('ein Anker außerhalb zentriert den Ausschnitt auf ihn', () => {
    const a = berechneAusschnitt(basis({ anker: 700 }));
    expect(a.von).toBeLessThanOrEqual(700);
    expect(a.bis).toBeGreaterThan(700);
    // Kein Ausschnitt von 0 bis 700: höchstens Sicht plus Überhang.
    expect(a.bis - a.von).toBeLessThanOrEqual(16);
    expect(a.oben).toBe(a.von * 50);
  });

  it('ein Anker im Ausschnitt verschiebt nichts', () => {
    expect(berechneAusschnitt(basis({ anker: 3 }))).toEqual(berechneAusschnitt(basis({})));
  });

  it('eine leere Liste hat keinen Ausschnitt', () => {
    expect(berechneAusschnitt(basis({ hoehen: [] }))).toEqual({
      von: 0,
      bis: 0,
      oben: 0,
      unten: 0,
      gesamt: 0,
    });
  });
});
