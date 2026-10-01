import { describe, expect, it, vi } from 'vitest';
import { formatiere } from '../anzeige/koordinaten';
import { koordinatenBefehl } from './koordinatenSprung';

/** Berlin, Alexanderplatz — ein Punkt in UTM-Zone 33 und GK-Zone 4. */
const BERLIN = { lat: 52.52194, lon: 13.41321 };

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
