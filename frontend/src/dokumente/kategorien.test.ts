import { describe, expect, it } from 'vitest';
import { DOKUMENT_KATEGORIEN, DOKUMENT_KATEGORIE_REIHENFOLGE } from './kategorien';

describe('Dokument-Kategorien', () => {
  it('REIHENFOLGE deckt jeden Schlüssel aus KATEGORIEN genau einmal ab', () => {
    // DOKUMENT_KATEGORIEN ist ein Record über das generierte Enum — eine neue Backend-Variante
    // bricht dort den Typcheck. Das allein sichert aber nicht, dass REIHENFOLGE (ein reines
    // Array) mitwächst: ein sechster Schlüssel bekäme ein Label und verschwände dort still
    // aus Anzeigereihenfolge/Filterliste. Diese beiden Prüfungen schließen genau diese Lücke.
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
