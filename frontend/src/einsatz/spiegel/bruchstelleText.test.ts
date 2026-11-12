import { describe, expect, it } from 'vitest';
import {
  bruchArtWort,
  bruchFolgenText,
  bruchKetteText,
  bruchOffenText,
  bruchStellbar,
} from './bruchstelleText';

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
    expect(
      bruchArtWort({ antrag_art: null, tabelle: 'person_uhs_belegung', kategorie: 'personen' }),
    ).toBe('UHS-Aufnahme');
    expect(bruchArtWort({ antrag_art: null, tabelle: 'haushalt', kategorie: 'betreuung' })).toBe(
      'Haushalt',
    );
  });

  it('zählt Folgezeilen nur, wenn es welche gibt', () => {
    expect(bruchFolgenText(0)).toBeNull();
    expect(bruchFolgenText(1)).toBe('+ 1 Zeile');
    expect(bruchFolgenText(3)).toBe('+ 3 Zeilen');
  });

  it('stellbar nur mit Antragsart, sichtbarem Inhalt und nicht schon gestellt', () => {
    expect(bruchStellbar({ antrag_art: 'etb', verborgen: false, nachgereicht: false })).toBe(true);
    expect(bruchStellbar({ antrag_art: 'etb', verborgen: true, nachgereicht: false })).toBe(false);
    expect(bruchStellbar({ antrag_art: null, verborgen: false, nachgereicht: false })).toBe(false);
    expect(bruchStellbar({ antrag_art: 'person', verborgen: false, nachgereicht: true })).toBe(
      false,
    );
  });

  it('nennt folgende Einträge nur an einer gestellten Person (LLH-1657)', () => {
    expect(bruchKetteText({ nachgereicht: false, folgen_offen: 3 })).toBeNull();
    expect(bruchKetteText({ nachgereicht: true, folgen_offen: 0 })).toBeNull();
    expect(bruchKetteText({ nachgereicht: true, folgen_offen: 1 })).toBe('1 Eintrag folgt');
    expect(bruchKetteText({ nachgereicht: true, folgen_offen: 3 })).toBe('3 Einträge folgen');
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
