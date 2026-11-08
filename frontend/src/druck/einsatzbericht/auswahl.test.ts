import { describe, expect, it } from 'vitest';
import {
  BLOECKE,
  KURZBERICHT,
  STANDARDUMFANG,
  istKurzbericht,
  istStandardumfang,
  parseBerichtAuswahl,
  umfangZeilen,
  type BlockSchluessel,
} from './auswahl';

/** Spec `einsatzbericht`, „Auswahl in der Adresse“ und „Druckkopf nennt den Umfang“ (LFH-902). */

const params = (s: string) => new URLSearchParams(s);

describe('BLOECKE', () => {
  it('Standardumfang sind die sieben Blöcke aus LFH-726 und die Hilfeleistungen nach der Bilanz', () => {
    expect(STANDARDUMFANG).toEqual([
      'stammdaten',
      'zeiten',
      'fuehrung',
      'kraefte',
      'lage',
      'bilanz',
      'hilfeleistungen',
      'etb',
    ]);
  });

  it('die drei Anlagen stehen am Ende und sind nicht Standard', () => {
    expect(BLOECKE.slice(-3).map((b) => [b.schluessel, b.titel, b.standard])).toEqual([
      ['einheiten-zeiten', 'Anlage Einheiten mit Einsatzzeiten', false],
      ['personal-kopf', 'Anlage Personal je Kopf', false],
      ['materialverbrauch', 'Anlage Materialverbrauch', false],
    ]);
  });

  it('der Kurzbericht wählt Stammdaten, Zeiten, Kräfte und Hilfeleistungen (LLH-1575)', () => {
    expect(KURZBERICHT).toEqual(['stammdaten', 'zeiten', 'kraefte', 'hilfeleistungen']);
    expect(istKurzbericht(['hilfeleistungen', 'stammdaten', 'kraefte', 'zeiten'])).toBe(true);
    expect(istKurzbericht([...KURZBERICHT, 'materialverbrauch'])).toBe(false);
    expect(istStandardumfang(KURZBERICHT)).toBe(false);
  });
});

describe('parseBerichtAuswahl', () => {
  it('ohne Parameter gilt der Standardumfang', () => {
    expect(parseBerichtAuswahl(params(''))).toEqual(STANDARDUMFANG);
  });

  it('liest die gewählten Blöcke', () => {
    expect(parseBerichtAuswahl(params('bloecke=stammdaten,kraefte,personal-kopf'))).toEqual([
      'stammdaten',
      'kraefte',
      'personal-kopf',
    ]);
  });

  it('ordnet nach Druckreihenfolge, nicht nach Adresse', () => {
    expect(parseBerichtAuswahl(params('bloecke=etb,stammdaten'))).toEqual(['stammdaten', 'etb']);
  });

  it('verwirft unbekannte und doppelte Schlüssel', () => {
    expect(parseBerichtAuswahl(params('bloecke=stammdaten,kosten,stammdaten, '))).toEqual([
      'stammdaten',
    ]);
  });

  it('nur unbekannte Schlüssel oder leerer Wert ergeben den Standardumfang', () => {
    expect(parseBerichtAuswahl(params('bloecke=kosten'))).toEqual(STANDARDUMFANG);
    expect(parseBerichtAuswahl(params('bloecke='))).toEqual(STANDARDUMFANG);
  });

  it('übersteht den Round-Trip durch URLSearchParams', () => {
    const p = new URLSearchParams();
    p.set('bloecke', ['stammdaten', 'einheiten-zeiten'].join(','));
    expect(parseBerichtAuswahl(new URLSearchParams(p.toString()))).toEqual([
      'stammdaten',
      'einheiten-zeiten',
    ]);
  });
});

describe('istStandardumfang', () => {
  it('erkennt genau die acht Standardblöcke', () => {
    expect(istStandardumfang(STANDARDUMFANG)).toBe(true);
    expect(istStandardumfang(STANDARDUMFANG.filter((b) => b !== 'bilanz'))).toBe(false);
    expect(istStandardumfang([...STANDARDUMFANG, 'personal-kopf'])).toBe(false);
  });
});

describe('umfangZeilen', () => {
  const wert = (a: readonly BlockSchluessel[]) => umfangZeilen(a).map((z) => [z.etikett, z.wert]);

  it('ohne Auswahl „Standardumfang“', () => {
    expect(wert(STANDARDUMFANG)).toEqual([['Umfang', 'Standardumfang']]);
  });

  it('mit Auswahl die gedruckten Blöcke in Druckreihenfolge', () => {
    expect(wert(['stammdaten', 'kraefte'])).toEqual([['Umfang', 'Auswahl: Stammdaten, Kräfte']]);
  });

  it('beim Kurzbericht dessen Namen, ergänzt wieder „Auswahl“ (LLH-1575)', () => {
    expect(wert(KURZBERICHT)).toEqual([['Umfang', 'Kurzbericht für den Auftraggeber']]);
    expect(wert([...KURZBERICHT, 'materialverbrauch'])).toEqual([
      ['Umfang', 'Auswahl: Stammdaten, Zeiten, Kräfte, Hilfeleistungen, Anlage Materialverbrauch'],
    ]);
  });

  it('mit der Personal-Anlage zusätzlich den Personenbezug', () => {
    expect(wert(['stammdaten', 'kraefte', 'personal-kopf'])).toEqual([
      ['Umfang', 'Auswahl: Stammdaten, Kräfte, Anlage Personal je Kopf'],
      ['Personenbezug', 'enthält Namen von Einsatzkräften'],
    ]);
  });
});
