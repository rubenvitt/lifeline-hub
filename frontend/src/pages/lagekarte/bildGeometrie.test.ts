import { describe, it, expect } from 'vitest';
import { eckenAusRechteck, rechteckAusEcken, eckenAusBounds } from './bildGeometrie';

describe('bildGeometrie', () => {
  it('achsenparalleles Rechteck (rotation 0) ergibt erwartete Ecken', () => {
    const ecken = eckenAusRechteck({ center: [9, 50], breiteGrad: 0.2, hoeheGrad: 0.1, rotationGrad: 0 });
    // TL, TR, BR, BL — lng links<rechts, lat oben>unten
    expect(ecken[0][0]).toBeLessThan(ecken[1][0]);   // TL.lng < TR.lng
    expect(ecken[0][1]).toBeGreaterThan(ecken[3][1]); // TL.lat > BL.lat
    expect(ecken[0][1]).toBeCloseTo(50.05, 6);        // oben = center.lat + hoehe/2
  });

  it('roundtrip Rechteck → Ecken → Rechteck ist stabil', () => {
    const r = { center: [9, 50] as [number, number], breiteGrad: 0.2, hoeheGrad: 0.1, rotationGrad: 30 };
    const zurueck = rechteckAusEcken(eckenAusRechteck(r));
    expect(zurueck.center[0]).toBeCloseTo(9, 6);
    expect(zurueck.center[1]).toBeCloseTo(50, 6);
    expect(zurueck.breiteGrad).toBeCloseTo(0.2, 6);
    expect(zurueck.hoeheGrad).toBeCloseTo(0.1, 6);
    expect(((zurueck.rotationGrad % 360) + 360) % 360).toBeCloseTo(30, 4);
  });

  it('Rotation ändert die Kantenlängen nicht (winkeltreu)', () => {
    // Die korrekte Invariante: DIESELBE Kante ist bei 0° und 45° gleich lang
    // (Rotation verzerrt nicht). NICHT breite==hoehe vergleichen — breiteGrad (lng-Grad)
    // und hoeheGrad (lat-Grad) haben verschiedene Bildschirm-Einheiten.
    const basis = { center: [9, 50] as [number, number], breiteGrad: 0.2, hoeheGrad: 0.1, rotationGrad: 0 };
    const e0 = eckenAusRechteck(basis);
    const e45 = eckenAusRechteck({ ...basis, rotationGrad: 45 });
    const latCos = Math.cos(50 * Math.PI / 180);
    const dist = (a: number[], b: number[]) => Math.hypot((a[0]-b[0])*latCos, a[1]-b[1]);
    expect(dist(e45[0], e45[1])).toBeCloseTo(dist(e0[0], e0[1]), 6); // obere Kante
    expect(dist(e45[1], e45[2])).toBeCloseTo(dist(e0[1], e0[2]), 6); // rechte Kante
  });

  it('eckenAusBounds liefert achsenparallele 4 Ecken', () => {
    const e = eckenAusBounds(8, 49, 9, 50);
    expect(e).toEqual([[8,50],[9,50],[9,49],[8,49]]);
  });
});
