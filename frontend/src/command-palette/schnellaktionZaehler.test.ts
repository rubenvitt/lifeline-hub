import { describe, expect, it } from 'vitest';
import {
  SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER,
  ZAEHLER_DECKEL,
  leseZaehler,
  naechsterZaehler,
  ordneNachNutzung,
} from './schnellaktionZaehler';
import type { BenutzerEinstellungen } from '../api/types';

const stand = (wert: string | undefined): BenutzerEinstellungen =>
  ({
    eintraege: wert === undefined ? {} : { [SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER]: wert },
  }) as BenutzerEinstellungen;

describe('leseZaehler', () => {
  it('liest das Objekt aus dem Serverstand', () => {
    expect(leseZaehler(stand('{"aktion:etb":3,"aktion:personen":1}'))).toEqual({
      'aktion:etb': 3,
      'aktion:personen': 1,
    });
  });

  it('liefert ohne Stand, ohne Eintrag oder bei kaputtem Wert ein leeres Objekt', () => {
    expect(leseZaehler(undefined)).toEqual({});
    expect(leseZaehler(stand(undefined))).toEqual({});
    expect(leseZaehler(stand('{kaputt'))).toEqual({});
    expect(leseZaehler(stand('[1,2]'))).toEqual({});
    expect(leseZaehler(stand('42'))).toEqual({});
    expect(leseZaehler(stand('null'))).toEqual({});
  });

  /** Der Wert ist serverseitig opak; ein älterer Client oder ein Fehler kann alles hineinschreiben. */
  it('räumt Unbrauchbares weg und deckelt', () => {
    expect(
      leseZaehler(
        stand(
          JSON.stringify({
            'aktion:etb': 2.5,
            'aktion:personen': -1,
            'aktion:tiere': '3',
            'aktion:schaeden': 0,
            'aktion:dokumente': 1e9,
            'aktion:unfallhilfsstellen': 4,
          }),
        ),
      ),
    ).toEqual({ 'aktion:dokumente': ZAEHLER_DECKEL, 'aktion:unfallhilfsstellen': 4 });
  });
});

describe('naechsterZaehler', () => {
  const bekannt = ['aktion:personen', 'aktion:etb', 'aktion:tiere'];

  it('zählt die Ausführung hoch und beginnt bei eins', () => {
    expect(naechsterZaehler({}, 'aktion:etb', bekannt)).toEqual({ 'aktion:etb': 1 });
    expect(naechsterZaehler({ 'aktion:etb': 4 }, 'aktion:etb', bekannt)).toEqual({
      'aktion:etb': 5,
    });
  });

  it('wirft Ids weg, die es nicht mehr gibt, und zählt keine unbekannte', () => {
    expect(
      naechsterZaehler({ 'aktion:stab-alt': 9, 'aktion:tiere': 1 }, 'aktion:etb', bekannt),
    ).toEqual({ 'aktion:tiere': 1, 'aktion:etb': 1 });
    expect(naechsterZaehler({ 'aktion:tiere': 1 }, 'aktion:unbekannt', bekannt)).toEqual({
      'aktion:tiere': 1,
    });
  });

  it('bleibt am Deckel stehen', () => {
    expect(naechsterZaehler({ 'aktion:etb': ZAEHLER_DECKEL }, 'aktion:etb', bekannt)).toEqual({
      'aktion:etb': ZAEHLER_DECKEL,
    });
  });

  /** Die Whitelist des Servers nimmt höchstens 2000 Zeichen; mit Deckel und Aufräumen hält das. */
  it('bleibt unter 2000 Zeichen, auch mit vielen vollen Zählern', () => {
    const viele = Array.from({ length: 30 }, (_, i) => `aktion:schnellaktion-nummer-${i}`);
    let z: Record<string, number> = {};
    for (const id of viele) z = { ...z, [id]: ZAEHLER_DECKEL };
    expect(JSON.stringify(naechsterZaehler(z, viele[0], viele)).length).toBeLessThan(2000);
  });
});

describe('ordneNachNutzung', () => {
  const zeilen = ['a', 'b', 'c', 'd'];
  const id = (x: string) => `aktion:${x}`;

  it('hält ohne Zählung die feste Folge', () => {
    expect(ordneNachNutzung(zeilen, id, {})).toEqual(['a', 'b', 'c', 'd']);
  });

  it('stellt die häufigste zuerst und hält bei Gleichstand die feste Folge', () => {
    expect(ordneNachNutzung(zeilen, id, { 'aktion:d': 3, 'aktion:b': 1, 'aktion:c': 1 })).toEqual([
      'd',
      'b',
      'c',
      'a',
    ]);
  });
});
