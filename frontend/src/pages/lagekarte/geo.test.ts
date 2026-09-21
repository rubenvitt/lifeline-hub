import { describe, expect, it } from 'vitest';
import {
  polygonZentroid,
  parseGeometry,
  polygonFlaecheM2,
  polygonUmfangM,
  lineLaengeM,
  formatFlaeche,
  formatLaenge,
  geoKennzahlen,
  punktInPolygon,
  geometrieZumKlickFeature,
  werteFachebenenKlickAus,
} from './geo';
import type { GeoJsonPolygon, GeoJsonLineString } from './geo';

// Ein 0,01° × 0,01°-Kästchen nahe Breite 50 (Rhein-Main). Als geschlossener Ring.
const BOX: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [8, 50],
      [8.01, 50],
      [8.01, 50.01],
      [8, 50.01],
      [8, 50],
    ],
  ],
};

describe('polygonZentroid', () => {
  it('Mittelpunkt eines Quadrats', () => {
    const gj = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    };
    const [lon, lat] = polygonZentroid(gj)!;
    expect(lon).toBeCloseTo(1, 6);
    expect(lat).toBeCloseTo(1, 6);
  });
  it('ungültig → null', () => {
    expect(polygonZentroid({ type: 'Polygon', coordinates: [] })).toBeNull();
  });
});

describe('parseGeometry', () => {
  it('liest ein Polygon', () => {
    const g = parseGeometry(
      '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
    );
    expect(g?.type).toBe('Polygon');
  });
  it('liest einen LineString', () => {
    const g = parseGeometry('{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}');
    expect(g?.type).toBe('LineString');
  });
  it('gibt null bei Unsinn / fremdem Typ zurück', () => {
    expect(parseGeometry('{"type":"Point","coordinates":[8.6,50.1]}')).toBeNull();
    expect(parseGeometry('kein json')).toBeNull();
    expect(parseGeometry(null)).toBeNull();
  });
});

describe('lineLaengeM', () => {
  it('1° Breiten-Segment ≈ 111195 m (Haversine, R=6371000)', () => {
    const line: GeoJsonLineString = {
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8, 51],
      ],
    };
    expect(lineLaengeM(line)).toBeCloseTo(111195, -2); // ±~50 m
  });
  it('summiert mehrere Segmente', () => {
    const line: GeoJsonLineString = {
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8, 50.5],
        [8, 51],
      ],
    };
    const einzeln: GeoJsonLineString = {
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8, 51],
      ],
    };
    expect(lineLaengeM(line)).toBeCloseTo(lineLaengeM(einzeln), 0);
  });
  it('leer/entartet → 0', () => {
    expect(lineLaengeM({ type: 'LineString', coordinates: [] })).toBe(0);
    expect(lineLaengeM({ type: 'LineString', coordinates: [[8, 50]] })).toBe(0);
  });
});

describe('polygonUmfangM', () => {
  it('Umfang = Summe der Außenring-Kanten (Haversine)', () => {
    // Rechteck: 2×(Breite + Höhe), unabhängig über lineLaengeM der Kanten geprüft.
    const breite = lineLaengeM({
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8.01, 50],
      ],
    });
    const hoehe = lineLaengeM({
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8, 50.01],
      ],
    });
    expect(polygonUmfangM(BOX)).toBeCloseTo(2 * (breite + hoehe), -1);
  });
  it('leer → 0', () => {
    expect(polygonUmfangM({ type: 'Polygon', coordinates: [] })).toBe(0);
  });
});

describe('polygonFlaecheM2', () => {
  it('Rechteck ≈ Breite × Höhe (Kreuzcheck gegen Haversine-Kanten, nicht dieselbe Projektion)', () => {
    const breite = lineLaengeM({
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8.01, 50],
      ],
    });
    const hoehe = lineLaengeM({
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8, 50.01],
      ],
    });
    const erwartet = breite * hoehe;
    const ist = polygonFlaecheM2(BOX);
    expect(Math.abs(ist - erwartet) / erwartet).toBeLessThan(0.02); // <2 %
  });
  it('leer/entartet → 0', () => {
    expect(polygonFlaecheM2({ type: 'Polygon', coordinates: [] })).toBe(0);
    // kollinear (Linie als „Polygon") → keine Fläche
    expect(
      polygonFlaecheM2({
        type: 'Polygon',
        coordinates: [
          [
            [8, 50],
            [8.02, 50],
            [8.04, 50],
            [8, 50],
          ],
        ],
      }),
    ).toBeCloseTo(0, 5);
  });
  it('Polygon mit Loch = Außenring minus Loch', () => {
    const aussen: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [8, 50],
          [8.02, 50],
          [8.02, 50.02],
          [8, 50.02],
          [8, 50],
        ],
      ],
    };
    const loch: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [8.005, 50.005],
          [8.015, 50.005],
          [8.015, 50.015],
          [8.005, 50.015],
          [8.005, 50.005],
        ],
      ],
    };
    const mitLoch: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [aussen.coordinates[0], loch.coordinates[0]],
    };
    const erwartet = polygonFlaecheM2(aussen) - polygonFlaecheM2(loch);
    expect(Math.abs(polygonFlaecheM2(mitLoch) - erwartet) / erwartet).toBeLessThan(0.01);
  });
});

describe('formatFlaeche (de-DE, Einheiten-Staffelung)', () => {
  it('< 10.000 m² → m² (0 Nachkommastellen)', () => {
    expect(formatFlaeche(500)).toBe('500 m²');
  });
  it('< 1.000.000 m² → ha (Komma-Dezimal)', () => {
    expect(formatFlaeche(15_000)).toBe('1,5 ha');
  });
  it('≥ 1.000.000 m² → km²', () => {
    expect(formatFlaeche(2_500_000)).toBe('2,5 km²');
  });
});

describe('formatLaenge (de-DE)', () => {
  it('< 1000 m → m', () => {
    expect(formatLaenge(500)).toBe('500 m');
  });
  it('≥ 1000 m → km (Komma-Dezimal)', () => {
    expect(formatLaenge(1500)).toBe('1,5 km');
  });
});

describe('geoKennzahlen (Dispatcher über lose Geometrie)', () => {
  it('Polygon → Fläche + Umfang, keine Länge', () => {
    const k = geoKennzahlen(BOX);
    expect(k?.flaecheM2).toBeGreaterThan(0);
    expect(k?.umfangM).toBeGreaterThan(0);
    expect(k?.laengeM).toBeUndefined();
  });
  it('LineString → Länge, keine Fläche', () => {
    const k = geoKennzahlen({
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8, 51],
      ],
    });
    expect(k?.laengeM).toBeGreaterThan(0);
    expect(k?.flaecheM2).toBeUndefined();
  });
  it('MultiPolygon → summierte Fläche + summierter Außenring-Umfang', () => {
    const einzeln = geoKennzahlen(BOX)!;
    const multi = geoKennzahlen({
      type: 'MultiPolygon',
      coordinates: [BOX.coordinates, BOX.coordinates],
    })!;
    expect(multi.flaecheM2).toBeCloseTo(2 * einzeln.flaecheM2!, -1);
    expect(multi.umfangM).toBeCloseTo(2 * einzeln.umfangM!, -1);
  });
  it('MultiLineString → summierte Länge', () => {
    const einzeln = geoKennzahlen({
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8, 51],
      ],
    })!;
    const multi = geoKennzahlen({
      type: 'MultiLineString',
      coordinates: [
        [
          [8, 50],
          [8, 51],
        ],
        [
          [8, 50],
          [8, 51],
        ],
      ],
    })!;
    expect(multi.laengeM).toBeCloseTo(2 * einzeln.laengeM!, 0);
  });
  it('Point/MultiPoint/Unsinn → null', () => {
    expect(geoKennzahlen({ type: 'Point', coordinates: [8, 50] })).toBeNull();
    expect(geoKennzahlen({ type: 'MultiPoint', coordinates: [[8, 50]] })).toBeNull();
  });
});

describe('punktInPolygon / Rückfall', () => {
  it('Punkt innerhalb → true, außerhalb → false', () => {
    expect(punktInPolygon({ lng: 8.005, lat: 50.005 }, BOX)).toBe(true);
    expect(punktInPolygon({ lng: 9, lat: 51 }, BOX)).toBe(false);
  });
  it('MultiPolygon mit Loch (even-odd): Punkt im Loch → false, im Vollteil → true', () => {
    const mitLoch = {
      type: 'MultiPolygon' as const,
      coordinates: [
        [
          [
            [8, 50],
            [8.02, 50],
            [8.02, 50.02],
            [8, 50.02],
            [8, 50],
          ], // Außenring
          [
            [8.005, 50.005],
            [8.015, 50.005],
            [8.015, 50.015],
            [8.005, 50.015],
            [8.005, 50.005],
          ], // Loch
        ],
      ],
    };
    expect(punktInPolygon({ lng: 8.01, lat: 50.01 }, mitLoch)).toBe(false); // im Loch
    expect(punktInPolygon({ lng: 8.001, lat: 50.001 }, mitLoch)).toBe(true); // im Rand-Vollteil
  });
  it('Rückfall ohne ID liefert die volle Geometrie des treffenden Features, Punkte zählen nicht', () => {
    const fc = {
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, geometry: BOX, properties: {} },
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [20, 20] },
          properties: {},
        },
      ],
    };
    const treffer = geometrieZumKlickFeature(undefined, { lng: 8.005, lat: 50.005 }, fc);
    expect(treffer?.type).toBe('Polygon');
    expect(geometrieZumKlickFeature(undefined, { lng: 0, lat: 0 }, fc)).toBeNull();
  });
});

// LFH-282: zwei an der Klickstelle ÜBERLAPPENDE Warnflächen verschiedener Größe — etwa eine
// Gewitterwarnung über dem Landkreis und eine kleinere Dauerregenwarnung darin. Die Kennzahlen
// müssen zu DEM Feature gehören, dessen Properties das Panel zeigt, nicht zum ersten, das den
// Punkt enthält.
describe('geometrieZumKlickFeature (LFH-282)', () => {
  const GROSS: GeoJsonPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [8, 50],
        [8.1, 50],
        [8.1, 50.1],
        [8, 50.1],
        [8, 50],
      ],
    ],
  };
  const KLEIN = BOX; // 0,01° × 0,01°, liegt ganz in GROSS — rund 100-mal kleiner
  const GEWITTER = { titel: 'Gewitter', stufe: 2, aktiv: true };
  const DAUERREGEN = { titel: 'Dauerregen', stufe: 2, aktiv: true };
  const fc = {
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, geometry: GROSS, properties: GEWITTER },
      { type: 'Feature' as const, geometry: KLEIN, properties: DAUERREGEN },
    ],
  };
  // Dieselben Warnungen nach einem Nachladen in umgekehrter Reihenfolge — NINA baut die Liste
  // über `buffer_unordered`, die Reihenfolge ist also von Abruf zu Abruf nicht stabil.
  const umsortiert = { ...fc, features: [fc.features[1], fc.features[0]] };
  const IM_UEBERLAPP = { lng: 8.005, lat: 50.005 };
  const NUR_IN_GROSS = { lng: 8.05, lat: 50.05 };

  it('Überlappung: die Properties des Klick-Features entscheiden, nicht die Collection-Reihenfolge', () => {
    expect(geometrieZumKlickFeature({ properties: DAUERREGEN }, IM_UEBERLAPP, fc)).toBe(KLEIN);
    expect(geometrieZumKlickFeature({ properties: GEWITTER }, IM_UEBERLAPP, fc)).toBe(GROSS);
  });

  it('veralteter Index nach dem Umsortieren führt nicht zur fremden Fläche', () => {
    // Der Klick trifft noch das alte Rendering (Index 0 = Gewitter), die Collection ist schon neu
    // (Index 0 = Dauerregen). Beide Flächen enthalten den Punkt — die Punkt-Prüfung am Index
    // allein hielte das nicht auf; der Abgleich der Properties tut es.
    expect(
      geometrieZumKlickFeature({ id: 0, properties: GEWITTER }, IM_UEBERLAPP, umsortiert),
    ).toBe(GROSS);
    expect(
      geometrieZumKlickFeature({ id: 1, properties: DAUERREGEN }, IM_UEBERLAPP, umsortiert),
    ).toBe(KLEIN);
  });

  it('gleiche Properties: die Feature-ID entscheidet zwischen den Kandidaten', () => {
    const zwilling = {
      ...fc,
      features: [
        { type: 'Feature' as const, geometry: GROSS, properties: GEWITTER },
        { type: 'Feature' as const, geometry: KLEIN, properties: GEWITTER },
      ],
    };
    expect(geometrieZumKlickFeature({ id: 1, properties: GEWITTER }, IM_UEBERLAPP, zwilling)).toBe(
      KLEIN,
    );
    expect(geometrieZumKlickFeature({ id: 0, properties: GEWITTER }, IM_UEBERLAPP, zwilling)).toBe(
      GROSS,
    );
    // Ohne brauchbare ID bleibt es mehrdeutig: keine Kennzahlen statt womöglich falscher.
    for (const id of [undefined, 2, -1, 0.5, '1']) {
      expect(geometrieZumKlickFeature({ id, properties: GEWITTER }, IM_UEBERLAPP, zwilling)).toBe(
        null,
      );
    }
  });

  it('nicht-primitive Property-Werte werden nicht verglichen (die Kachel führt sie als JSON-Text)', () => {
    const mitListe = {
      ...fc,
      features: [
        { type: 'Feature' as const, geometry: GROSS, properties: { ...GEWITTER, gebiete: ['A'] } },
      ],
    };
    const klick = { properties: { ...GEWITTER, gebiete: '["A"]' } };
    expect(geometrieZumKlickFeature(klick, IM_UEBERLAPP, mitListe)).toBe(GROSS);
  });

  it('ohne Klick-Feature: nur der eindeutige Treffer, sonst null', () => {
    expect(geometrieZumKlickFeature(undefined, NUR_IN_GROSS, fc)).toBe(GROSS);
    expect(geometrieZumKlickFeature(undefined, IM_UEBERLAPP, fc)).toBeNull();
    expect(geometrieZumKlickFeature(undefined, { lng: 20, lat: 20 }, fc)).toBeNull();
  });

  it('Klick-Auswertung reicht die Properties durch und nimmt die Geometrie desselben Features', () => {
    const { props, geometrie } = werteFachebenenKlickAus(
      { id: 0, properties: DAUERREGEN },
      IM_UEBERLAPP,
      fc,
    );
    expect(props).toBe(DAUERREGEN);
    expect(geometrie).toBe(KLEIN);
    expect(werteFachebenenKlickAus(undefined, IM_UEBERLAPP, fc)).toEqual({
      props: {},
      geometrie: null,
    });
  });
});
