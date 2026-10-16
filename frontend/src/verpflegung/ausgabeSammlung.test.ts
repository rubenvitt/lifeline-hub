import { describe, expect, it } from 'vitest';
import type { Kostform } from '../api/types';
import { VERPFLEGUNG_EP_MAX } from '../api/eingabegrenzen';
import { AusgabeSammlung, HOECHSTDAUER_MS, HOECHSTMENGE, RUHE_MS } from './ausgabeSammlung';
import { KOSTFORMEN } from './verpflegungText';

/** Kleiner deterministischer Zufall (mulberry32), damit ein roter Lauf wiederholbar ist. */
function zufall(saat: number): () => number {
  let a = saat >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('AusgabeSammlung (LLH-1032, design.md D2)', () => {
  it('pinnt die Grenzen als Literale', () => {
    expect(RUHE_MS).toBe(3000);
    expect(HOECHSTDAUER_MS).toBe(15000);
    expect(HOECHSTMENGE).toBe(50);
    expect(VERPFLEGUNG_EP_MAX).toBe(100_000);
  });

  it('eine leere Sammlung hat Menge 0, keine Sonderkost und schließt nicht ab', () => {
    const s = new AusgabeSammlung();
    expect(s.istLeer).toBe(true);
    expect(s.menge).toBe(0);
    expect(s.sonderkost.vegan).toBe(0);
    expect(s.mussAbschliessen(1_000_000)).toBe(false);
    expect(s.naechsterAbschluss()).toBeNull();
    expect(s.abschluss()).toBeNull();
  });

  it('„+1“, „+5“, „+10“ zählen Normalkost; eine Kostform zählt in die Menge mit', () => {
    const s = new AusgabeSammlung();
    s.tippe(1, 0);
    s.tippe(5, 10);
    s.tippe(10, 20);
    s.tippe(1, 30, 'vegetarisch');
    s.tippe(1, 40, 'vegetarisch');
    expect(s.menge).toBe(18);
    expect(s.sonderkost).toMatchObject({ vegetarisch: 2, vegan: 0 });
  });

  it('„−1“ nimmt die oberste Portion, auch eine Sonderkost-Portion; leer heißt verworfen', () => {
    const s = new AusgabeSammlung();
    s.tippe(1, 0);
    s.tippe(1, 10, 'vegan');
    s.nimmZurueck();
    expect(s.menge).toBe(1);
    expect(s.sonderkost.vegan).toBe(0);
    s.nimmZurueck();
    expect(s.istLeer).toBe(true);
    // Verworfen: kein Bündel, kein Zeitgeber.
    expect(s.abschluss()).toBeNull();
    expect(s.naechsterAbschluss()).toBeNull();
    // „−1“ auf leer bleibt leer.
    s.nimmZurueck();
    expect(s.menge).toBe(0);
  });

  it('„−1“ nach „+5“ nimmt eine der fünf, nicht alle', () => {
    const s = new AusgabeSammlung();
    s.tippe(5, 0);
    s.nimmZurueck();
    expect(s.menge).toBe(4);
  });

  it('Eigenschaft: über zufällige Tippfolgen samt „−1“ gilt Σ Sonderkost ≤ Menge und Menge ≥ 1 oder leer', () => {
    for (let saat = 1; saat <= 200; saat++) {
      const r = zufall(saat);
      const s = new AusgabeSammlung();
      for (let schritt = 0; schritt < 60; schritt++) {
        const wahl = r();
        if (wahl < 0.3) s.nimmZurueck();
        else if (wahl < 0.6) s.tippe(1, schritt, KOSTFORMEN[Math.floor(r() * KOSTFORMEN.length)]);
        else s.tippe([1, 5, 10][Math.floor(r() * 3)], schritt);
        const summe = KOSTFORMEN.reduce((n, k) => n + s.sonderkost[k], 0);
        expect(summe).toBeLessThanOrEqual(s.menge);
        expect(s.istLeer ? s.menge === 0 : s.menge >= 1).toBe(true);
      }
    }
  });

  it('abschluss() gibt das Bündel heraus und leert es im selben Schritt; ein zweiter Aufruf liefert nichts', () => {
    const s = new AusgabeSammlung();
    s.tippe(3, 0);
    s.tippe(1, 1, 'vegetarisch');
    s.tippe(1, 2, 'vegetarisch');
    expect(s.abschluss()).toEqual({ menge: 5, sonderkost: { vegetarisch: 2 } });
    expect(s.istLeer).toBe(true);
    expect(s.abschluss()).toBeNull();
  });

  it('ohne Sonderkost trägt das Bündel kein Feld `sonderkost`', () => {
    const s = new AusgabeSammlung();
    s.tippe(20, 0);
    expect(s.abschluss()).toEqual({ menge: 20 });
  });

  it('Abschluss nach 3 s Ruhe, spätestens 15 s nach dem ersten Tipp, sofort ab 50', () => {
    const ruhe = new AusgabeSammlung();
    ruhe.tippe(1, 1000);
    expect(ruhe.mussAbschliessen(1000 + 2999)).toBe(false);
    expect(ruhe.mussAbschliessen(1000 + 3000)).toBe(true);
    expect(ruhe.naechsterAbschluss()).toBe(4000);

    const dauer = new AusgabeSammlung();
    for (let t = 0; t < 15_000; t += 2000) {
      dauer.tippe(1, t);
      expect(dauer.mussAbschliessen(t)).toBe(false);
    }
    expect(dauer.naechsterAbschluss()).toBe(15_000);
    expect(dauer.mussAbschliessen(15_000)).toBe(true);

    const menge = new AusgabeSammlung();
    menge.tippe(49, 0);
    expect(menge.mussAbschliessen(0)).toBe(false);
    menge.tippe(1, 0);
    expect(menge.mussAbschliessen(0)).toBe(true);
  });

  it('Platz bis zur Höchstmenge = VERPFLEGUNG_EP_MAX − Menge der Sammlung', () => {
    const s = new AusgabeSammlung();
    expect(s.platz).toBe(100_000);
    s.tippe(10, 0);
    expect(s.platz).toBe(100_000 - 10);
    // Mehr als Platz nimmt die Sammlung nicht an, eine nicht ganze oder nicht positive Zahl auch nicht.
    expect(s.tippe(99_995, 1)).toBe(false);
    expect(s.tippe(0, 1)).toBe(false);
    expect(s.tippe(1.5, 1)).toBe(false);
    expect(s.menge).toBe(10);
    expect(s.tippe(99_990, 1)).toBe(true);
    expect(s.menge).toBe(100_000);
  });

  it('die erste Zeit gilt ab dem ersten Tipp nach einem Abschluss neu', () => {
    const s = new AusgabeSammlung();
    s.tippe(1, 0);
    s.abschluss();
    s.tippe(1, 20_000);
    expect(s.mussAbschliessen(20_000 + 2000)).toBe(false);
    expect(s.naechsterAbschluss()).toBe(23_000);
  });

  it('jede Kostform lässt sich zählen', () => {
    const s = new AusgabeSammlung();
    KOSTFORMEN.forEach((k: Kostform, i) => s.tippe(1, i, k));
    expect(s.abschluss()).toEqual({
      menge: 5,
      sonderkost: {
        vegetarisch: 1,
        vegan: 1,
        ohne_schwein: 1,
        diaet_allergenarm: 1,
        saeugling_kleinkind: 1,
      },
    });
  });
});
