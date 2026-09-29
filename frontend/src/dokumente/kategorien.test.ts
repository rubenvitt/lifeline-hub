import { describe, expect, it } from 'vitest';
import { DOKUMENT_KATEGORIEN, DOKUMENT_KATEGORIE_REIHENFOLGE } from './kategorien';

describe('Dokument-Kategorien', () => {
  it('REIHENFOLGE deckt jeden Schlüssel aus KATEGORIEN genau einmal ab', () => {
    // Der Record über das generierte Enum bricht bei neuer Variante den Typcheck, das Array
    // REIHENFOLGE aber nicht — ohne diese Prüfungen verschwände ein neuer Schlüssel still aus
    // Anzeigereihenfolge und Filterliste.
    const schluessel = Object.keys(DOKUMENT_KATEGORIEN).sort();
    const reihenfolge = [...DOKUMENT_KATEGORIE_REIHENFOLGE].sort();
    expect(reihenfolge).toEqual(schluessel);
  });

  it('REIHENFOLGE enthält keine Dubletten', () => {
    expect(new Set(DOKUMENT_KATEGORIE_REIHENFOLGE).size).toBe(
      DOKUMENT_KATEGORIE_REIHENFOLGE.length,
    );
  });
});
