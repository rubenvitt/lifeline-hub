import { describe, expect, it } from 'vitest';
import type { GeoJsonLineString, GeoJsonPolygon } from './geo';
import {
  eckenJeRing,
  istGeaendert,
  kannEntfernen,
  punktZahl,
  sichtbareGriffe,
  starteBearbeitung,
  wendeAn,
  zwischenpunkte,
} from './zonenBearbeitung';

const QUADRAT: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [9, 54],
      [9.01, 54],
      [9.01, 54.01],
      [9, 54.01],
      [9, 54],
    ],
  ],
};
const DREIECK: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [9, 54],
      [9.01, 54],
      [9, 54.01],
      [9, 54],
    ],
  ],
};
const LINIE: GeoJsonLineString = {
  type: 'LineString',
  coordinates: [
    [9, 54],
    [9.01, 54],
    [9.02, 54.01],
  ],
};

describe('zonenBearbeitung (LLH-1344)', () => {
  it('zählt die Ecken ohne den Schlusspunkt einer Fläche', () => {
    expect(eckenJeRing(QUADRAT)[0]).toHaveLength(4);
    expect(punktZahl(starteBearbeitung(QUADRAT))).toBe(4);
    expect(punktZahl(starteBearbeitung(LINIE))).toBe(3);
  });

  it('verschiebt eine Ecke, hält den Ring geschlossen und wählt den Punkt', () => {
    const s = wendeAn(starteBearbeitung(QUADRAT), {
      art: 'verschieben',
      punkt: { ring: 0, index: 0 },
      lage: [8.99, 53.99],
    });
    const ring = (s.geometrie as GeoJsonPolygon).coordinates[0];
    expect(ring[0]).toEqual([8.99, 53.99]);
    expect(ring[ring.length - 1]).toEqual([8.99, 53.99]);
    expect(ring).toHaveLength(5);
    expect(s.gewaehlt).toEqual({ ring: 0, index: 0 });
    expect(istGeaendert(s)).toBe(true);
  });

  it('fügt zwischen zwei Ecken ein, auch auf der Schlusskante einer Fläche', () => {
    const s0 = starteBearbeitung(QUADRAT);
    const mitten = zwischenpunkte(QUADRAT);
    expect(mitten).toHaveLength(4);
    const schluss = mitten[3];
    expect(schluss).toMatchObject({ ring: 0, nach: 3 });
    expect(schluss.lage[0]).toBe(9);
    expect(schluss.lage[1]).toBeCloseTo(54.005, 9);
    const s = wendeAn(s0, { art: 'einfuegen', ring: 0, nach: 3, lage: schluss.lage });
    expect(punktZahl(s)).toBe(5);
    expect(eckenJeRing(s.geometrie)[0][4]).toEqual(schluss.lage);
    expect(s.gewaehlt).toEqual({ ring: 0, index: 4 });
  });

  it('eine Linie hat keine Kante hinter dem letzten Punkt', () => {
    expect(zwischenpunkte(LINIE)).toHaveLength(2);
    const s0 = starteBearbeitung(LINIE);
    expect(wendeAn(s0, { art: 'einfuegen', ring: 0, nach: 2, lage: [0, 0] })).toBe(s0);
  });

  it('entfernt nur über dem Minimum: Fläche 3, Linie 2', () => {
    const quadrat = wendeAn(starteBearbeitung(QUADRAT), {
      art: 'waehlen',
      punkt: { ring: 0, index: 1 },
    });
    expect(kannEntfernen(quadrat)).toBe(true);
    const drei = wendeAn(quadrat, { art: 'entfernen' });
    expect(punktZahl(drei)).toBe(3);
    expect(drei.gewaehlt).toBeNull();

    const dreieck = wendeAn(starteBearbeitung(DREIECK), {
      art: 'waehlen',
      punkt: { ring: 0, index: 0 },
    });
    expect(kannEntfernen(dreieck)).toBe(false);
    expect(wendeAn(dreieck, { art: 'entfernen' })).toBe(dreieck);

    const zwei = wendeAn(
      wendeAn(starteBearbeitung(LINIE), { art: 'waehlen', punkt: { ring: 0, index: 2 } }),
      { art: 'entfernen' },
    );
    expect(punktZahl(zwei)).toBe(2);
    expect(kannEntfernen(wendeAn(zwei, { art: 'waehlen', punkt: { ring: 0, index: 0 } }))).toBe(
      false,
    );
  });

  it('ohne Wahl lässt sich nichts entfernen', () => {
    expect(kannEntfernen(starteBearbeitung(QUADRAT))).toBe(false);
  });

  it('„zurück“ nimmt die letzte Änderung, „verwerfen“ alle', () => {
    let s = starteBearbeitung(QUADRAT);
    s = wendeAn(s, { art: 'verschieben', punkt: { ring: 0, index: 0 }, lage: [8, 53] });
    s = wendeAn(s, { art: 'einfuegen', ring: 0, nach: 0, lage: [8.5, 53.5] });
    expect(punktZahl(s)).toBe(5);
    const eins = wendeAn(s, { art: 'zurueck' });
    expect(punktZahl(eins)).toBe(4);
    expect(istGeaendert(eins)).toBe(true);
    const null_ = wendeAn(eins, { art: 'zurueck' });
    expect(istGeaendert(null_)).toBe(false);
    expect(wendeAn(null_, { art: 'zurueck' })).toBe(null_);

    const weg = wendeAn(s, { art: 'verwerfen' });
    expect(weg.geometrie).toEqual(QUADRAT);
    expect(weg.verlauf).toEqual([]);
    expect(istGeaendert(weg)).toBe(false);
  });

  it('ein Zug an dieselbe Stelle ist keine Änderung', () => {
    const s0 = starteBearbeitung(QUADRAT);
    const s = wendeAn(s0, {
      art: 'verschieben',
      punkt: { ring: 0, index: 2 },
      lage: [9.01, 54.01],
    });
    expect(istGeaendert(s)).toBe(false);
    expect(s.verlauf).toEqual([]);
    expect(s.gewaehlt).toEqual({ ring: 0, index: 2 });
  });

  it('unbekannte Punkte ändern nichts', () => {
    const s0 = starteBearbeitung(QUADRAT);
    expect(wendeAn(s0, { art: 'verschieben', punkt: { ring: 1, index: 0 }, lage: [0, 0] })).toBe(
      s0,
    );
    expect(wendeAn(s0, { art: 'waehlen', punkt: { ring: 0, index: 9 } })).toBe(s0);
  });

  describe('sichtbareGriffe', () => {
    it('lässt gedrängte Ecken weg, der gewählte Punkt steht immer', () => {
      const ecken = [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
      ];
      const ohne = sichtbareGriffe(ecken, 'Polygon', 44);
      expect(ohne.ecken[0]).toEqual([true, false, true, true]);
      const mit = sichtbareGriffe(ecken, 'Polygon', 44, { ring: 0, index: 1 });
      expect(mit.ecken[0]).toEqual([false, true, true, true]);
    });

    it('Zwischengriffe nur an Kanten ab zwei Griffkanten Länge', () => {
      const ecken = [
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 200, y: 0 },
        ],
      ];
      expect(sichtbareGriffe(ecken, 'LineString', 44).kanten[0]).toEqual([false, true]);
      // Fläche: dazu die Schlusskante vom letzten zum ersten Punkt.
      expect(sichtbareGriffe(ecken, 'Polygon', 44).kanten[0]).toEqual([false, true, true]);
    });

    it('ein Kreis mit 64 Ecken klein auf dem Schirm trägt wenige Griffe', () => {
      const ring = Array.from({ length: 64 }, (_, i) => ({
        x: 40 * Math.cos((i / 64) * 2 * Math.PI),
        y: 40 * Math.sin((i / 64) * 2 * Math.PI),
      }));
      const g = sichtbareGriffe([ring], 'Polygon', 44);
      expect(g.ecken[0].filter(Boolean).length).toBeLessThanOrEqual(12);
      expect(g.kanten[0].some(Boolean)).toBe(false);
    });
  });
});
