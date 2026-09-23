import { describe, expect, it } from 'vitest';
import { messErgebnis } from './messung';

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
