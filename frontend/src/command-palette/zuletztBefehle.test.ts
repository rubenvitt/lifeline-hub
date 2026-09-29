import { describe, expect, it } from 'vitest';
import {
  SCHLUESSEL_ZULETZT_BEFEHLE,
  ZULETZT_BEFEHLE_MAX,
  leseZuletztBefehle,
  naechsteZuletztBefehle,
} from './zuletztBefehle';
import type { BenutzerEinstellungen } from '../api/types';

/** Serverstand mit genau einem Schlüssel — der Rohtext kommt so, wie er in der Spalte steht. */
function stand(roh: string): BenutzerEinstellungen {
  return { eintraege: { [SCHLUESSEL_ZULETZT_BEFEHLE]: roh } };
}

describe('leseZuletztBefehle — der Wert ist opaker Text, kein Vertrag', () => {
  it('liest ein JSON-Array von IDs', () => {
    expect(leseZuletztBefehle(stand('["nav:profil","koord:utm"]'))).toEqual([
      'nav:profil',
      'koord:utm',
    ]);
  });

  it('liefert nichts, solange nichts geladen oder nichts gespeichert ist', () => {
    expect(leseZuletztBefehle(undefined)).toEqual([]);
    expect(leseZuletztBefehle({ eintraege: {} })).toEqual([]);
  });

  /**
   * Der Wert ist serverseitig OPAKER Text ohne Typ; ein `.slice` auf `JSON.parse('42')` würfe mitten
   * im Bau der Befehlsliste.
   */
  it('behandelt kaputten oder fremden Inhalt als „nichts gemerkt"', () => {
    expect(leseZuletztBefehle(stand('kein json'))).toEqual([]);
    expect(leseZuletztBefehle(stand('42'))).toEqual([]);
    expect(leseZuletztBefehle(stand('{"a":1}'))).toEqual([]);
    expect(leseZuletztBefehle(stand('["ok",7,null,{"x":1}]'))).toEqual(['ok']);
  });

  /**
   * Zwei gleiche IDs ergäben zwei Knoten mit derselben `cmd-<id>` und machten
   * `aria-activedescendant` mehrdeutig.
   */
  it('entdoppelt und deckelt, weil der Serverwert von einem älteren Client stammen kann', () => {
    expect(leseZuletztBefehle(stand('["a","b","a"]'))).toEqual(['a', 'b']);
    const viele = Array.from({ length: ZULETZT_BEFEHLE_MAX + 3 }, (_, i) => `id${i}`);
    expect(leseZuletztBefehle(stand(JSON.stringify(viele)))).toHaveLength(ZULETZT_BEFEHLE_MAX);
    expect(leseZuletztBefehle(stand(JSON.stringify(viele)))[0]).toBe('id0');
  });
});

describe('naechsteZuletztBefehle — MRU', () => {
  it('setzt den jüngsten Befehl nach vorn', () => {
    expect(naechsteZuletztBefehle(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  /** Ein Hin und Her zwischen zwei Befehlen darf die Liste nicht mit Kopien füllen
   *  (dieselbe Regel wie `merkeModulBesuch`). */
  it('verschiebt eine bestehende Nennung, statt sie zu verdoppeln', () => {
    expect(naechsteZuletztBefehle(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('deckelt auf die Höchstzahl', () => {
    const voll = Array.from({ length: ZULETZT_BEFEHLE_MAX }, (_, i) => `id${i}`);
    const neu = naechsteZuletztBefehle(voll, 'frisch');
    expect(neu).toHaveLength(ZULETZT_BEFEHLE_MAX);
    expect(neu[0]).toBe('frisch');
    expect(neu).not.toContain(`id${ZULETZT_BEFEHLE_MAX - 1}`);
  });

  it('lässt die Eingabe unberührt', () => {
    const vorher = ['a', 'b'];
    naechsteZuletztBefehle(vorher, 'c');
    expect(vorher).toEqual(['a', 'b']);
  });
});
