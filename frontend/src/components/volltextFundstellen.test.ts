import { describe, expect, it } from 'vitest';
import { fundstellen, suchphrasen, zerlegeNachFundstellen } from './volltextFundstellen';

/** Die markierten Stücke eines Textes, in Lesereihenfolge. */
function markiert(text: string, suche: string): string[] {
  return fundstellen(text, suchphrasen(suche)).map((f) => text.slice(f.start, f.ende));
}

/**
 * LFH-1056: Die Markierung zeigt, was der Server gefunden hat. Die Phrasenbildung spiegelt
 * `fts_query` (`src/etb/repo.rs`), die Faltung den FTS5-Tokenizer `unicode61`.
 */
describe('suchphrasen spiegelt fts_query (fts_query_setzt_praefix_je_wort)', () => {
  it('jedes Wort wird eine Phrase', () => {
    expect(suchphrasen('Deich Nord')).toEqual([['deich'], ['nord']]);
  });

  it('Anführungszeichen sind kein Teil des Wortes', () => {
    expect(suchphrasen('sag "hi"')).toEqual([['sag'], ['hi']]);
  });

  it('Wörter ohne Buchstaben oder Ziffern fallen weg', () => {
    expect(suchphrasen('* :')).toEqual([]);
    expect(suchphrasen('   ')).toEqual([]);
  });

  it('ein Wort mit Trennzeichen ist eine Phrase aus mehreren Tokens', () => {
    expect(suchphrasen('B-1')).toEqual([['b', '1']]);
  });
});

describe('fundstellen', () => {
  it('markiert Wortanfänge, nicht Wortmitten', () => {
    expect(markiert('Deichbruch Abschnitt Nord', 'Deich Nord')).toEqual(['Deich', 'Nord']);
    expect(markiert('Hochdeich', 'Deich Nord')).toEqual([]);
  });

  it('faltet Groß/Klein und Diakritika wie unicode61', () => {
    expect(markiert('Gebäude eingestürzt', 'gebaude')).toEqual(['Gebäude']);
    expect(markiert('GEBÄUDE', 'Gebäude')).toEqual(['GEBÄUDE']);
    expect(markiert('İstanbul', 'istan')).toEqual(['İstan']);
  });

  it('faltet, was unicode61 nicht faltet, auch nicht', () => {
    // ß bleibt ß, Ø und Ł haben keine Zerlegung, kyrillische Zeichen behalten ihre Diakritika,
    // Zeichen mit zwei Diakritika bleiben ganz (remove_diacritics=1).
    expect(markiert('Straße', 'strasse')).toEqual([]);
    expect(markiert('Øresund', 'oresund')).toEqual([]);
    expect(markiert('Łódź', 'lodz')).toEqual([]);
    expect(markiert('йод', 'иод')).toEqual([]);
    expect(markiert('ǖber', 'uber')).toEqual([]);
  });

  it('ein zerlegtes Zeichen bleibt mit seinem Diakritikum zusammen', () => {
    const text = 'Gebau\u0308de';
    expect(markiert(text, 'gebaude')).toEqual([text]);
    expect(markiert(text, 'gebau')).toEqual(['Gebau\u0308']);
  });

  it('eine Phrase deckt ihre Trennzeichen mit ab', () => {
    expect(markiert('Trupp B-12 vor Ort', 'B-1')).toEqual(['B-1']);
    expect(markiert('B 1 und B-1', 'B-1')).toEqual(['B 1', 'B-1']);
    expect(markiert('B-2', 'B-1')).toEqual([]);
    // Nur das LETZTE Token ist ein Wortanfang (`"B-1"*`), die davor stehen ganz.
    expect(markiert('Bau-12', 'B-1')).toEqual([]);
  });

  it('Satzzeichen trennen Wörter', () => {
    expect(markiert('(Nord-Süd), snake_case', 'süd case')).toEqual(['Süd', 'case']);
  });

  it('jedes Vorkommen, überlappende Treffer zusammengefasst', () => {
    expect(markiert('Nord, Norden, nord', 'nord')).toEqual(['Nord', 'Nord', 'nord']);
    expect(markiert('Deichbruch', 'Dei Deich')).toEqual(['Deich']);
  });

  it('ohne Suchbegriff nichts', () => {
    expect(fundstellen('Deich', suchphrasen(''))).toEqual([]);
  });
});

describe('zerlegeNachFundstellen', () => {
  it('teilt den Text in markierte und unmarkierte Stücke', () => {
    expect(zerlegeNachFundstellen('Deichbruch Nord', suchphrasen('nord deich'))).toEqual([
      { text: 'Deich', fund: true },
      { text: 'bruch ', fund: false },
      { text: 'Nord', fund: true },
    ]);
  });

  it('ab einem Versatz: davor wird nicht markiert', () => {
    expect(zerlegeNachFundstellen('#12 · 12 Kräfte', suchphrasen('12'), 6)).toEqual([
      { text: '#12 · ', fund: false },
      { text: '12', fund: true },
      { text: ' Kräfte', fund: false },
    ]);
  });

  it('ohne Fundstelle ein einziges Stück', () => {
    expect(zerlegeNachFundstellen('Deich', suchphrasen('nord'))).toEqual([
      { text: 'Deich', fund: false },
    ]);
  });
});
