import { describe, it, expect } from 'vitest';
import { markerToUrl } from './markerToUrl';
import type { KarteMarker } from './marker';

function m(over: Partial<KarteMarker> & { typ: KarteMarker['typ']; id: number }): KarteMarker {
  return { schluessel: 'x', lat: 0, lon: 0, label: 'L', farbe: '#000', ...over };
}
const E = 7;

describe('markerToUrl (LFH-25) — Inspector-Deeplinks je Marker-Typ', () => {
  it('uhs → Item-Route', () => {
    expect(markerToUrl(m({ typ: 'uhs', id: 9 }), E)).toBe('/einsaetze/7/unfallhilfsstellen/9');
  });
  it('schaden → Item-Route (LFH-148)', () => {
    expect(markerToUrl(m({ typ: 'schaden', id: 5 }), E)).toBe('/einsaetze/7/schaeden/5');
  });
  it('einheit → Listen-Selektion', () => {
    expect(markerToUrl(m({ typ: 'einheit', id: 3 }), E)).toBe('/einsaetze/7/einheiten?einheit=3');
  });
  it('fahrzeug → Listen-Selektion', () => {
    expect(markerToUrl(m({ typ: 'fahrzeug', id: 4 }), E)).toBe('/einsaetze/7/fahrzeuge?fahrzeug=4');
  });
  it('fuehrung → Personal-Liste mit ?personal= (EinsatzPersonal.id)', () => {
    expect(markerToUrl(m({ typ: 'fuehrung', id: 8 }), E)).toBe('/einsaetze/7/personal?personal=8');
  });
  it('abschnitt → Abschnitte-Liste mit ?abschnitt=', () => {
    expect(markerToUrl(m({ typ: 'abschnitt', id: 2 }), E)).toBe(
      '/einsaetze/7/einsatzabschnitte?abschnitt=2',
    );
  });
  it('lagemeldung → Quell-Meldung (?meldung=meldungId, NICHT marker.id)', () => {
    const marker = m({
      typ: 'lagemeldung',
      id: 99,
      lageMeldung: { meldungId: 42, meldungLfdNr: 7, absender: 'A', inhalt: 'I' },
    });
    expect(markerToUrl(marker, E)).toBe('/einsaetze/7/meldungen?meldung=42');
  });
  it('betreuungsstelle → Item-Route der Detailseite (LLH-1044)', () => {
    expect(markerToUrl(m({ typ: 'betreuungsstelle', id: 4 }), E)).toBe('/einsaetze/7/betreuung/4');
  });
  it('bereitstellungsraum → Item-Route der BR-Detailseite (LLH-1107)', () => {
    expect(markerToUrl(m({ typ: 'bereitstellungsraum', id: 6 }), E)).toBe(
      '/einsaetze/7/bereitstellungsraeume/6',
    );
  });
  it('person → Item-Route der Personen-Detailseite (LFH-648), nicht die Einsatzdaten', () => {
    // Ohne eigenen Zweig fiele `person` still in den `default` — der Typcheck warnte nicht.
    expect(markerToUrl(m({ typ: 'person', id: 11 }), E)).toBe('/einsaetze/7/personen/11');
  });
  it('einsatzort → Einsatzdaten (Fallback ohne Item-Bezug)', () => {
    expect(markerToUrl(m({ typ: 'einsatzort', id: 0 }), E)).toBe('/einsaetze/7/einsatzdaten');
  });
});
