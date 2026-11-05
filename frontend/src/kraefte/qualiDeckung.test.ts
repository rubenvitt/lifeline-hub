import { describe, expect, it } from 'vitest';
import datei from '../../../tests/fixtures/quali_deckung_faelle.json';
import {
  abschluss,
  deckt,
  einschlussKandidaten,
  einschluesseAus,
  offeneAnforderungen,
} from './qualiDeckung';

const katalog = einschluesseAus(datei.katalog);

describe('qualiDeckung (LLH-1553)', () => {
  // Dieselben Fälle wie `src/personal/qualifikation_deckung.rs` (Gleichlauf).
  it.each(datei.faelle.map((f) => [f.name, f] as const))('%s', (_, fall) => {
    expect(offeneAnforderungen(katalog, fall.soll, fall.personen)).toEqual(fall.offen);
  });

  it('Abschluss folgt der Kette und bricht einen Kreis ab', () => {
    expect(abschluss(katalog, 3)).toEqual([3, 2, 1]);
    const kreis = new Map<number, number | null>([
      [1, 2],
      [2, 1],
    ]);
    expect(abschluss(kreis, 1)).toEqual([1, 2]);
  });

  it('deckt über die Kette, nicht nach oben', () => {
    expect(deckt(katalog, [3], 1)).toBe(true);
    expect(deckt(katalog, [1], 3)).toBe(false);
  });

  it('Kandidaten für „Schließt ein“ lassen sich selbst und Kreise weg', () => {
    const ids = einschlussKandidaten(katalog, datei.katalog, 1).map((q) => q.id);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(3);
    expect(ids).toContain(4);
    expect(einschlussKandidaten(katalog, datei.katalog, null)).toHaveLength(8);
  });
});
