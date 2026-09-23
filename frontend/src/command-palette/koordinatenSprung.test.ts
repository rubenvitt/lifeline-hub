import { describe, expect, it, vi } from 'vitest';
import { formatiere } from '../anzeige/koordinaten';
import { erkenneKoordinate, koordinatenBefehl } from './koordinatenSprung';

/** Berlin, Alexanderplatz — ein Punkt in UTM-Zone 33 und GK-Zone 4. */
const BERLIN = { lat: 52.52194, lon: 13.41321 };

/** Auf fünf Nachkommastellen verglichen: ≙ rund 1 m, genauer tippt niemand ab. */
function nahe(
  ist: { lat: number; lon: number } | null,
  soll: { lat: number; lon: number },
  dez = 3,
) {
  expect(ist).not.toBeNull();
  expect(ist!.lat).toBeCloseTo(soll.lat, dez);
  expect(ist!.lon).toBeCloseTo(soll.lon, dez);
}

describe('erkenneKoordinate — an der FORM, nicht am eingestellten Format', () => {
  it('Dezimalgrad mit Punkt und Komma/Leerzeichen/Semikolon als Trenner', () => {
    nahe(erkenneKoordinate('52.52194, 13.41321'), BERLIN, 5);
    nahe(erkenneKoordinate('52.52194 13.41321'), BERLIN, 5);
    nahe(erkenneKoordinate('52.52194;13.41321'), BERLIN, 5);
    nahe(erkenneKoordinate('  52.52194,13.41321  '), BERLIN, 5);
    nahe(erkenneKoordinate('-33.8688, 151.2093'), { lat: -33.8688, lon: 151.2093 }, 5);
  });

  it('Dezimalgrad mit Dezimalkomma braucht einen eindeutigen Trenner', () => {
    // „52,5, 13,4" ist nicht eindeutig zerlegbar — mit Semikolon oder Leerzeichen schon.
    nahe(erkenneKoordinate('52,52194; 13,41321'), BERLIN, 5);
    nahe(erkenneKoordinate('52,52194 13,41321'), BERLIN, 5);
  });

  it('MGRS in beiden Schreibweisen — so, wie der Koordinatenwechsel sie ausgibt', () => {
    const mgrs = formatiere(BERLIN.lat, BERLIN.lon, 'mgrs'); // „33U UU 91… 20…"
    nahe(erkenneKoordinate(mgrs), BERLIN);
    nahe(erkenneKoordinate(mgrs.replace(/\s+/g, '')), BERLIN);
    nahe(erkenneKoordinate(mgrs.toLowerCase()), BERLIN);
  });

  it('MGRS mit weniger Stellen (1 km) bleibt erlaubt, wenn der Rückweg passt', () => {
    // 4 Ziffern ≙ 1-km-Quadrat. Dieselbe Zeichenkette muss beim Zurückrechnen herauskommen —
    // das ist der Riegel gegen die Kennungen im Negativtest unten.
    const km = formatiere(BERLIN.lat, BERLIN.lon, 'mgrs').replace(
      /(\d{2})\d{3} (\d{2})\d{3}$/,
      '$1 $2',
    );
    nahe(erkenneKoordinate(km), BERLIN, 1);
  });

  it('UTM, Gauß-Krüger und Grad/Minuten/Sekunden aus der eigenen Formatierung', () => {
    for (const system of ['utm', 'gk', 'dms'] as const) {
      nahe(erkenneKoordinate(formatiere(BERLIN.lat, BERLIN.lon, system)), BERLIN, 3);
    }
  });

  it('erkennt KEINE Koordinate in Suchbegriffen, Kennungen und Zahlen', () => {
    // Die tragende Hälfte: jeder Fehlgriff hier stellte eine Kartenzeile VOR einen
    // Nummerntreffer oder eine Modulzeile.
    for (const s of [
      '',
      'deich',
      '42',
      'R-42',
      '#42',
      '12 34', // zwei ganze Zahlen — Hausnummer, Stärke, alles mögliche
      '52 13',
      '52.5', // ein halber Punkt
      '52.5, 13.4, 7',
      '91.0, 13.0', // Breite ausserhalb
      '52.0, 181.0', // Länge ausserhalb
      '32U', // nur Gitterzone
      '32U MV', // Gitterzone + Quadrat ohne Ziffern
      '32U MV 123 4567', // ungerade Ziffernzahl
      'Florian 1/44-1',
      '1/3/18//22', // Stärke-Schreibweise
      // Review-Befund zu LFH-619: Fahrzeug-/Einheitenkennungen und Uhrzeiten haben die Form
      // „Zahl · Buchstabe · zwei Buchstaben · Ziffern" — die mgrs-Bibliothek rechnet sie
      // ungeprüft in Punkte im Südpazifik um. Ohne Riegel stünde die Kartenzeile oben und
      // Enter flöge die Karte weg, statt das Fahrzeug zu öffnen.
      '1 HLF 20',
      '1 TLF 3000',
      '2 DLK 23',
      '5 SEG 12',
      '12 Uhr 30',
      '10 Uhr 15',
      '12.30 13.45', // Uhrzeitspanne
      '8.15, 9.30',
    ]) {
      expect(erkenneKoordinate(s), s).toBeNull();
    }
  });
});

describe('koordinatenBefehl', () => {
  it('springt auf die Lagekarte mit ?zentrum= und beschriftet im eingestellten Format', () => {
    const ziele: string[] = [];
    const b = koordinatenBefehl({
      einsatzId: 5,
      punkt: BERLIN,
      format: 'mgrs',
      navigate: (p) => ziele.push(p),
    });
    expect(b.gruppe).toBe('koordinate');
    expect(b.label).toBe(`Auf Lagekarte zeigen · ${formatiere(BERLIN.lat, BERLIN.lon, 'mgrs')}`);
    expect(b.kontext).toBe('Koordinate');
    b.ausfuehren();
    expect(ziele).toHaveLength(1);
    const zentrum = new URL(ziele[0], 'http://x').searchParams.get('zentrum');
    expect(new URL(ziele[0], 'http://x').pathname).toBe('/einsaetze/5/lagekarte');
    expect(zentrum).toBe('52.52194,13.41321');
  });

  it('die id trägt den Punkt, damit zwei Eingaben nicht dieselbe Zeile sind', () => {
    const a = koordinatenBefehl({
      einsatzId: 5,
      punkt: BERLIN,
      format: 'wgs84',
      navigate: () => {},
    });
    const b = koordinatenBefehl({
      einsatzId: 5,
      punkt: { lat: 50, lon: 8 },
      format: 'wgs84',
      navigate: () => {},
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe('koordinatenBefehl — Öffnungsart (LFH-645)', () => {
  it('trägt die Lagekarte als Ziel und reicht den neuen Tab durch', () => {
    const navigate = vi.fn();
    const b = koordinatenBefehl({ einsatzId: 5, punkt: BERLIN, format: 'wgs84', navigate });
    expect(b.ziel).toMatch(/^\/einsaetze\/5\/lagekarte\?/);
    b.ausfuehren('neuerTab');
    expect(navigate).toHaveBeenCalledWith(b.ziel, 'neuerTab');
    navigate.mockClear();
    b.ausfuehren();
    expect(navigate).toHaveBeenCalledWith(b.ziel);
    expect(b.vorschau).toBeUndefined();
  });
});
