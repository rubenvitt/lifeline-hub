import { describe, expect, it } from 'vitest';
import {
  hatListenZustand,
  listenZustandParams,
  parseListenZustand,
  type ListenZustandAdresse,
} from './deeplinks';

/**
 * Listenzustand in der Adresse (LLH-1086, Spec `tabellen-sortieren-filtern`): Sortierung, Spalten-
 * filter und Suchbegriff einer Liste. Kodierung per Round-Trip durch `URLSearchParams` geprüft
 * (`frontend/AGENTS.md`, Deeplink-Muster).
 */
const rundlauf = (zustand: ListenZustandAdresse, vorher = '') => {
  const params = listenZustandParams(new URLSearchParams(vorher), zustand);
  // Wie der Browser: einmal als Zeichenkette in die Adresse und zurück.
  return {
    text: params.toString(),
    zurueck: parseListenZustand(new URLSearchParams(params.toString())),
  };
};

describe('Listenzustand in der Adresse (LLH-1086)', () => {
  it('Sortierung, Filter und Suche überstehen den Rundlauf', () => {
    const zustand: ListenZustandAdresse = {
      sortierung: { spalte: 'frist', richtung: 'auf' },
      filter: { ausmass: ['gross', 'mittel'], typ: ['sturm'] },
      suche: 'Deich & Damm = 3',
    };
    const { text, zurueck } = rundlauf(zustand);
    expect(text).toContain('sort=frist%3Aauf');
    expect(text).toContain('f.ausmass=gross%2Cmittel');
    expect(zurueck).toEqual(zustand);
  });

  it('Werte mit Komma und Prozent kommen unverändert zurück', () => {
    const zustand: ListenZustandAdresse = {
      sortierung: undefined,
      filter: { ort: ['a,b', '100%'] },
      suche: '',
    };
    expect(rundlauf(zustand).zurueck).toEqual(zustand);
  });

  it('„bewusst unsortiert“ ist „aus“, die Vorgabe steht nicht in der Adresse', () => {
    expect(rundlauf({ sortierung: null, filter: {}, suche: '' })).toEqual({
      text: 'sort=aus',
      zurueck: { sortierung: null, filter: {}, suche: '' },
    });
    expect(rundlauf({ sortierung: undefined, filter: {}, suche: '' })).toEqual({
      text: '',
      zurueck: { sortierung: undefined, filter: {}, suche: '' },
    });
  });

  it('leere Filter und Leerraum-Suche fallen heraus; fremde Parameter bleiben stehen', () => {
    const { text } = rundlauf(
      { sortierung: undefined, filter: { typ: [] }, suche: '   ' },
      'neu=1&f.alt=x&sort=ort:ab&q=weg',
    );
    expect(text).toBe('neu=1');
  });

  it('verwirft eine kaputte Sortierung ganz', () => {
    for (const roh of ['sort=frist', 'sort=frist:quer', 'sort=:auf', 'sort=']) {
      expect(parseListenZustand(new URLSearchParams(roh)).sortierung).toBeUndefined();
    }
    expect(parseListenZustand(new URLSearchParams('sort=reg:ab')).sortierung).toEqual({
      spalte: 'reg',
      richtung: 'ab',
    });
  });

  it('erkennt, ob die Adresse überhaupt einen Listenzustand trägt', () => {
    expect(hatListenZustand(new URLSearchParams('neu=1'))).toBe(false);
    expect(hatListenZustand(new URLSearchParams('sort=aus'))).toBe(true);
    expect(hatListenZustand(new URLSearchParams('f.typ=sturm'))).toBe(true);
    expect(hatListenZustand(new URLSearchParams('q=Deich'))).toBe(true);
  });
});
