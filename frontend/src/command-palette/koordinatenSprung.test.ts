import { describe, expect, it } from 'vitest';
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
