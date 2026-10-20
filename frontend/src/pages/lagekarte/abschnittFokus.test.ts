import { describe, expect, it } from 'vitest';
import {
  baueFokusSicht,
  daempfeFlaechen,
  daempfeMarker,
  eigeneAbschnitte,
  escZiel,
  fokusRahmen,
  kraefteZuordnung,
  type FokusQuelle,
} from './abschnittFokus';
import type { KarteMarker } from './marker';
import type { GeoJsonPolygon } from './geo';

/** Rechteck als GeoJSON-Polygon (geschlossen). */
function rechteck(w: number, s: number, o: number, n: number): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [o, s],
        [o, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

function marker(schluessel: string, lon = 9, lat = 52): KarteMarker {
  const [typ, id] = schluessel.split('-');
  return {
    schluessel,
    typ: typ as KarteMarker['typ'],
    id: Number(id ?? 0),
    lat,
    lon,
    label: schluessel,
    farbe: '#555',
  };
}

// EA 1 (1) mit UA 1.1 (11), EA 2 (2); Einheiten: 100 in EA 1, 101 unter 100 (erbt EA 1),
// 110 in UA 1.1, 200 in EA 2, 300 ohne Abschnitt. Fahrzeuge: 500 bei 101, 600 bei 200, 700 frei.
const QUELLE: FokusQuelle = {
  abschnitte: [
    { id: 1, name: 'EA 1 Unterstadt', ueber_abschnitt_id: null },
    { id: 11, name: 'UA 1.1 Hafen', ueber_abschnitt_id: 1 },
    { id: 2, name: 'EA 2 Oberstadt', ueber_abschnitt_id: null },
  ],
  einheiten: [
    { id: 100, ueber_einheit_id: null, abschnitt_id: 1, abschnitt_name: 'EA 1 Unterstadt' },
    { id: 101, ueber_einheit_id: 100, abschnitt_id: null, abschnitt_name: null },
    { id: 110, ueber_einheit_id: null, abschnitt_id: 11, abschnitt_name: 'UA 1.1 Hafen' },
    { id: 200, ueber_einheit_id: null, abschnitt_id: 2, abschnitt_name: 'EA 2 Oberstadt' },
    { id: 300, ueber_einheit_id: null, abschnitt_id: null, abschnitt_name: null },
  ],
  fahrzeuge: [
    { id: 500, einheit_id: 101 },
    { id: 600, einheit_id: 200 },
    { id: 700, einheit_id: null },
  ],
};

describe('eigeneAbschnitte (LLH-1057)', () => {
  it('nimmt den Abschnitt samt aller Unterabschnitte', () => {
    expect([...eigeneAbschnitte(1, QUELLE.abschnitte)].sort()).toEqual([1, 11]);
    expect([...eigeneAbschnitte(2, QUELLE.abschnitte)]).toEqual([2]);
  });

  it('bricht einen Zyklus ab', () => {
    const zyklus = [
      { id: 1, ueber_abschnitt_id: 2 },
      { id: 2, ueber_abschnitt_id: 1 },
    ];
    expect([...eigeneAbschnitte(1, zyklus)].sort()).toEqual([1, 2]);
  });
});

describe('kraefteZuordnung (LLH-1057)', () => {
  it('ordnet Einheiten (eigener oder geerbter Abschnitt), Fahrzeuge über die Einheit und Abschnittszeichen zu', () => {
    const z = kraefteZuordnung(QUELLE);
    expect(z.get('einheit-100')).toBe(1);
    expect(z.get('einheit-101')).toBe(1);
    expect(z.get('einheit-110')).toBe(11);
    expect(z.get('einheit-300')).toBeNull();
    expect(z.get('fahrzeug-500')).toBe(1);
    expect(z.get('fahrzeug-600')).toBe(2);
    expect(z.get('fahrzeug-700')).toBeNull();
    expect(z.get('abschnitt-2')).toBe(2);
    // Führungskräfte tragen keinen Abschnittsbezug: sie stehen nicht in der Zuordnung.
    expect(z.has('fuehrung-1')).toBe(false);
  });
});

describe('baueFokusSicht (LLH-1057)', () => {
  it('ist null für einen unbekannten Abschnitt', () => {
    expect(baueFokusSicht(99, QUELLE)).toBeNull();
  });

  it('trägt Name und eigene Abschnitte', () => {
    const sicht = baueFokusSicht(1, QUELLE)!;
    expect(sicht.name).toBe('EA 1 Unterstadt');
    expect([...sicht.eigene].sort()).toEqual([1, 11]);
  });
});

describe('daempfeMarker (LLH-1057)', () => {
  const alle = [
    'einheit-100',
    'einheit-110',
    'einheit-200',
    'einheit-300',
    'fahrzeug-500',
    'fahrzeug-600',
    'fuehrung-1',
    'abschnitt-1',
    'abschnitt-11',
    'abschnitt-2',
    'schaden-4',
    'uhs-5',
  ].map((s) => marker(s));

  it('ohne Fokus kommt dieselbe Liste zurück', () => {
    expect(daempfeMarker(alle, null)).toBe(alle);
  });

  it('dämpft nur die Kräfte fremder Abschnitte und entfernt nichts', () => {
    const sicht = baueFokusSicht(1, QUELLE);
    const ergebnis = daempfeMarker(alle, sicht);
    expect(ergebnis).toHaveLength(alle.length);
    const gedaempft = ergebnis.filter((m) => m.gedaempft).map((m) => m.schluessel);
    expect(gedaempft).toEqual(['einheit-200', 'fahrzeug-600', 'abschnitt-2']);
  });

  it('lässt ungedämpfte Marker in ihrer Identität', () => {
    const sicht = baueFokusSicht(1, QUELLE);
    const ergebnis = daempfeMarker(alle, sicht);
    expect(ergebnis[0]).toBe(alle[0]);
    expect(ergebnis[2]).not.toBe(alle[2]);
  });
});

describe('daempfeFlaechen (LLH-1057)', () => {
  const flaechen = [
    { id: 1, label: 'EA 1', polygon: rechteck(9, 52, 9.1, 52.1) },
    { id: 11, label: 'UA 1.1', polygon: rechteck(9, 52, 9.05, 52.05) },
    { id: 2, label: 'EA 2', polygon: rechteck(10, 53, 10.1, 53.1) },
  ];

  it('ohne Fokus dieselbe Liste', () => {
    expect(daempfeFlaechen(flaechen, null)).toBe(flaechen);
  });

  it('dämpft fremde Flächen, eigene und Unterabschnitte bleiben voll', () => {
    const ergebnis = daempfeFlaechen(flaechen, baueFokusSicht(1, QUELLE));
    expect(ergebnis.map((f) => f.gedaempft ?? false)).toEqual([false, false, true]);
  });
});

describe('fokusRahmen (LLH-1057)', () => {
  it('rahmt die Fläche des Abschnitts ein', () => {
    const sicht = baueFokusSicht(1, QUELLE)!;
    const rahmen = fokusRahmen(
      sicht,
      [{ id: 1, polygon: rechteck(9, 52, 9.1, 52.2) }],
      [marker('einheit-100', 20, 60)],
    );
    expect(rahmen).toEqual([
      [9, 52],
      [9.1, 52.2],
    ]);
  });

  it('ohne Fläche rahmt er die eigenen verorteten Kräfte ein, fremde nicht', () => {
    const sicht = baueFokusSicht(1, QUELLE)!;
    const rahmen = fokusRahmen(
      sicht,
      [{ id: 2, polygon: rechteck(10, 53, 10.1, 53.1) }],
      [
        marker('einheit-100', 9, 52),
        marker('fahrzeug-500', 9.2, 52.3),
        marker('einheit-110', 9.1, 51.9),
        marker('einheit-200', 30, 30),
        marker('schaden-1', 40, 40),
      ],
    );
    expect(rahmen).toEqual([
      [9, 51.9],
      [9.2, 52.3],
    ]);
  });

  it('nimmt ohne eigene Fläche die Flächen der Unterabschnitte mit', () => {
    const sicht = baueFokusSicht(1, QUELLE)!;
    expect(fokusRahmen(sicht, [{ id: 11, polygon: rechteck(8, 50, 8.5, 50.5) }], [])).toEqual([
      [8, 50],
      [8.5, 50.5],
    ]);
  });

  it('ist null ohne Fläche und ohne verortete Kräfte', () => {
    const sicht = baueFokusSicht(2, QUELLE)!;
    expect(fokusRahmen(sicht, [], [marker('einheit-100')])).toBeNull();
  });
});

describe('escZiel (LLH-1057)', () => {
  it('erst die Auswahl, dann der Fokus', () => {
    expect(escZiel(true)).toBe('auswahl');
    expect(escZiel(false)).toBe('fokus');
  });
});
