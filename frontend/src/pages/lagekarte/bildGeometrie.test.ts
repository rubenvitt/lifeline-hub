import { describe, it, expect } from 'vitest';
import {
  zentroid,
  verschiebeEcken,
  skaliereUmAnker,
  skaliereKante,
  rotiereUmZentroid,
  eckenInitialPixel,
  eckenAusBounds,
  type Punkt,
} from './bildGeometrie';
import type { Ecken } from '../../api/kartenbilder';

const quadrat: [Punkt, Punkt, Punkt, Punkt] = [
  [0, 0], // TL
  [10, 0], // TR
  [10, 10], // BR
  [0, 10], // BL
];

describe('bildGeometrie', () => {
  it('zentroid mittelt die vier Ecken', () => {
    expect(zentroid(quadrat)).toEqual([5, 5]);
  });

  it('verschiebeEcken verschiebt alle Ecken gleich (keine Verzerrung)', () => {
    const e: Ecken = [
      [9, 50],
      [11, 50],
      [11, 48],
      [9, 48],
    ];
    const v = verschiebeEcken(e, 1, -2);
    expect(v).toEqual([
      [10, 48],
      [12, 48],
      [12, 46],
      [10, 46],
    ]);
  });

  it('skaliereUmAnker: Zug auf der Diagonale skaliert uniform, Anker bleibt fix', () => {
    // Griff BR (Index 2), Anker TL (Index 0) = [0,0]. Maus auf Diagonale bei [20,20] → Faktor 2.
    const e = skaliereUmAnker(quadrat, 2, [20, 20]);
    expect(e[0]).toEqual([0, 0]); // Anker unverändert
    expect(e[2]).toEqual([20, 20]); // Griff folgt der Maus
    expect(e[1]).toEqual([20, 0]); // TR
    expect(e[3]).toEqual([0, 20]); // BL
  });

  it('skaliereUmAnker: schräger Zug bleibt seitenverhältnistreu (kein Scheren)', () => {
    // Maus rechteckig versetzt: [20,10]. Faktor = (20*10+10*10)/(10²+10²) = 300/200 = 1,5.
    const e = skaliereUmAnker(quadrat, 2, [20, 10]);
    // Quadrat bleibt Quadrat (alle Kanten gleich lang), nur um 1,5 skaliert.
    const breite = e[1][0] - e[0][0];
    const hoehe = e[3][1] - e[0][1];
    expect(breite).toBeCloseTo(15, 6);
    expect(hoehe).toBeCloseTo(15, 6);
    expect(breite).toBeCloseTo(hoehe, 6);
  });

  it('skaliereUmAnker: minFaktor verhindert Kollaps/Umklappen', () => {
    // Maus hinter dem Anker (negative Projektion) → würde ohne Klemmung umklappen.
    const e = skaliereUmAnker(quadrat, 2, [-50, -50], 0.1);
    // Faktor auf 0,1 geklemmt → Griff bei [1,1], nicht negativ.
    expect(e[2][0]).toBeCloseTo(1, 6);
    expect(e[2][1]).toBeCloseTo(1, 6);
  });

  it('skaliereKante „rechts": streckt nur die Breite, Anker links + Höhe bleiben', () => {
    const e = skaliereKante(quadrat, 'rechts', [20, 5]);
    expect(e[0]).toEqual([0, 0]); // TL (Anker) fix
    expect(e[3]).toEqual([0, 10]); // BL (Anker) fix
    expect(e[1]).toEqual([20, 0]); // TR auf neue Breite
    expect(e[2]).toEqual([20, 10]); // BR auf neue Breite
    // Höhe unverändert (10), Breite jetzt 20 → Seitenverhältnis bewusst geändert.
    expect(e[3][1] - e[0][1]).toBe(10);
  });

  it('skaliereKante „unten": streckt nur die Höhe, Anker oben + Breite bleiben', () => {
    const e = skaliereKante(quadrat, 'unten', [5, 30]);
    expect(e[0]).toEqual([0, 0]); // TL fix
    expect(e[1]).toEqual([10, 0]); // TR fix
    expect(e[3]).toEqual([0, 30]); // BL auf neue Höhe
    expect(e[2]).toEqual([10, 30]); // BR auf neue Höhe
    expect(e[1][0] - e[0][0]).toBe(10); // Breite unverändert
  });

  it('skaliereKante: minPx verhindert Kollaps/Umklappen', () => {
    const e = skaliereKante(quadrat, 'rechts', [-50, 5], 8);
    expect(e[1]).toEqual([8, 0]);
    expect(e[2]).toEqual([8, 10]);
  });

  it('rotiereUmZentroid: 90° dreht das Quadrat um seine Mitte', () => {
    const e = rotiereUmZentroid(quadrat, Math.PI / 2);
    // Mitte [5,5] bleibt; TL [0,0] → [10,0]; Kantenlängen bleiben.
    expect(e[0][0]).toBeCloseTo(10, 6);
    expect(e[0][1]).toBeCloseTo(0, 6);
    expect(zentroid(e)[0]).toBeCloseTo(5, 6);
    expect(zentroid(e)[1]).toBeCloseTo(5, 6);
  });

  it('eckenInitialPixel: Breite/Seitenverhältnis korrekt, TL/TR oben', () => {
    const e = eckenInitialPixel([100, 100], 40, 2); // ar=2 → Höhe 20
    expect(e[0]).toEqual([80, 90]); // TL
    expect(e[1]).toEqual([120, 90]); // TR
    expect(e[2]).toEqual([120, 110]); // BR
    expect(e[3]).toEqual([80, 110]); // BL
    const breite = e[1][0] - e[0][0];
    const hoehe = e[3][1] - e[0][1];
    expect(breite / hoehe).toBeCloseTo(2, 6); // Seitenverhältnis = ar
  });

  it('eckenAusBounds liefert achsenparallele 4 Ecken', () => {
    expect(eckenAusBounds(8, 49, 9, 50)).toEqual([
      [8, 50],
      [9, 50],
      [9, 49],
      [8, 49],
    ]);
  });
});
