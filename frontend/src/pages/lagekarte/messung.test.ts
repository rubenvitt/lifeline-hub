import { describe, expect, it } from 'vitest';
import { messErgebnis, radiusMessung } from './messung';

// 0,001° Breite ≈ 111,19 m (Kugelmodell von `geo.ts`), gleich am Äquator in Länge.
const A = [9, 52];
const B = [9, 52.001];

describe('messErgebnis (LFH-616)', () => {
  it('ohne Geometrie steht ein Strich, keine erfundene Null', () => {
    expect(messErgebnis('strecke', null)).toEqual({ haupt: '—' });
    expect(messErgebnis('flaeche', null)).toEqual({ haupt: '—' });
  });

  it('Strecke: Länge des Linienzugs, ab dem zweiten Punkt', () => {
    expect(messErgebnis('strecke', { type: 'LineString', coordinates: [A] })).toEqual({
      haupt: '—',
    });
    expect(messErgebnis('strecke', { type: 'LineString', coordinates: [A, B] })).toEqual({
      haupt: '111 m',
    });
    // Über zwei Abschnitte summiert, ab 1 km in km.
    const C = [9, 52.01];
    expect(messErgebnis('strecke', { type: 'LineString', coordinates: [A, B, C] }).haupt).toBe(
      '1,1 km',
    );
  });

  it('Fläche: Inhalt und Umfang, erst ab drei verschiedenen Punkten', () => {
    // terra-draw liefert den laufenden Entwurf als geschlossenen Ring mit Wiederholungen.
    const entartet = { type: 'Polygon', coordinates: [[A, B, B, A]] };
    expect(messErgebnis('flaeche', entartet)).toEqual({ haupt: '—' });

    const quadrat = {
      type: 'Polygon',
      coordinates: [
        [
          [9, 52],
          [9.001, 52],
          [9.001, 52.001],
          [9, 52.001],
          [9, 52],
        ],
      ],
    };
    const e = messErgebnis('flaeche', quadrat);
    // ≈ 111,19 m × 68,46 m (cos 52°) ≈ 7612 m²
    expect(e.haupt).toMatch(/^7\.6\d\d m²$/);
    expect(e.neben).toMatch(/^Umfang 359 m$/);
  });

  it('nimmt die Geometrie der gewählten Form, nicht die andere', () => {
    // Nach dem Umschalten kann für einen Takt noch die alte Geometrie anliegen.
    expect(messErgebnis('flaeche', { type: 'LineString', coordinates: [A, B] })).toEqual({
      haupt: '—',
    });
    expect(
      messErgebnis('strecke', { type: 'Polygon', coordinates: [[A, B, [9.001, 52], A]] }),
    ).toEqual({ haupt: '—' });
  });
});

describe('messErgebnis Radius (LLH-1043)', () => {
  it('Radius aus Mitte und Rand, daneben die Kreisfläche', () => {
    expect(messErgebnis('radius', { type: 'LineString', coordinates: [A] })).toEqual({
      haupt: '—',
    });
    // π · 111,19² ≈ 38 841 m² → 3,9 ha.
    expect(messErgebnis('radius', { type: 'LineString', coordinates: [A, B] })).toEqual({
      haupt: 'r = 111 m',
      neben: 'Fläche 3,9 ha',
    });
  });

  it('zählt nur die ersten beiden verschiedenen Punkte: ein dritter Klick ändert nichts', () => {
    const C = [9, 52.01];
    expect(messErgebnis('radius', { type: 'LineString', coordinates: [A, A, B, C] }).haupt).toBe(
      'r = 111 m',
    );
  });

  it('eine Fläche ist kein Radius', () => {
    expect(
      messErgebnis('radius', { type: 'Polygon', coordinates: [[A, B, [9.001, 52], A]] }),
    ).toEqual({ haupt: '—' });
  });
});

describe('radiusMessung (LLH-1345)', () => {
  it('Mitte und Radius aus den ersten beiden verschiedenen Punkten, wie die Anzeige', () => {
    expect(radiusMessung(null)).toBeNull();
    expect(radiusMessung({ type: 'LineString', coordinates: [A] })).toBeNull();
    // terra-draw wiederholt im Entwurf den ersten Punkt: noch kein Rand.
    expect(radiusMessung({ type: 'LineString', coordinates: [A, A] })).toBeNull();
    const r = radiusMessung({ type: 'LineString', coordinates: [A, A, B, [9, 52.01]] });
    expect(r?.mitte).toEqual({ lon: 9, lat: 52 });
    expect(r?.radiusM).toBeCloseTo(111.19, 1);
  });

  it('eine Fläche ist kein Radius', () => {
    expect(radiusMessung({ type: 'Polygon', coordinates: [[A, B, [9.001, 52], A]] })).toBeNull();
  });
});
