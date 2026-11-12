import { describe, expect, it } from 'vitest';
import { bruchArtWort, bruchFolgenText, bruchOffenText, bruchStellbar } from './bruchstelleText';

describe('Nicht übernommene Erfassungen (LLH-1646)', () => {
  it('nennt die Art nach Antrag, Tabelle oder Bereich', () => {
    expect(bruchArtWort({ antrag_art: 'meldung', tabelle: 'meldung', kategorie: 'etb' })).toBe(
      'Meldung',
    );
    expect(bruchArtWort({ antrag_art: null, tabelle: 'etb_eintrag', kategorie: 'etb' })).toBe(
      'ETB-Eintrag',
    );
    expect(bruchArtWort({ antrag_art: null, tabelle: 'lage_objekt', kategorie: 'lage' })).toBe(
      'Lagekarte',
    );
  });

  it('zählt Folgezeilen nur, wenn es welche gibt', () => {
    expect(bruchFolgenText(0)).toBeNull();
    expect(bruchFolgenText(1)).toBe('+ 1 Zeile');
    expect(bruchFolgenText(3)).toBe('+ 3 Zeilen');
  });

  it('stellbar nur mit Antragsart und sichtbarem Inhalt', () => {
    expect(bruchStellbar({ antrag_art: 'etb', verborgen: false })).toBe(true);
    expect(bruchStellbar({ antrag_art: 'etb', verborgen: true })).toBe(false);
    expect(bruchStellbar({ antrag_art: null, verborgen: false })).toBe(false);
  });

  it('fasst offene Gründe nach „Alle stellen“ zusammen', () => {
    expect(bruchOffenText([])).toBeNull();
    expect(
      bruchOffenText([
        { grund: 'Bezug noch nicht beim Führer.' },
        { grund: 'Bezug noch nicht beim Führer.' },
      ]),
    ).toBe('2 nicht gestellt: Bezug noch nicht beim Führer.');
  });
});
