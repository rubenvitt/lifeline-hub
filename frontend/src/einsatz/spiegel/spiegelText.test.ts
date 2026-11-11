import { describe, expect, it } from 'vitest';
import {
  KEINE_VERBINDUNG_AB_MS,
  antragDatenText,
  antragErfassungsort,
  antragZaehler,
  bruchArtWort,
  bruchFolgenText,
  bruchOffenText,
  bruchStellbar,
  spiegelStand,
  spiegelTitel,
} from './spiegelText';

const zeit = (w: string) => `[${w}]`;
const letzter = '2026-11-10 08:00:00';
const letzterMs = Date.parse('2026-11-10T08:00:00Z');

describe('Hinweisband am Spiegel (LLH-1492, Spec `einsatz-spiegel`)', () => {
  it('nennt die Gegenstelle', () => {
    expect(spiegelTitel({ gegenstelle: 'ELW 1' })).toBe('Spiegel von ELW 1');
  });

  it('zeigt den letzten Abgleich, solange er frisch ist', () => {
    expect(
      spiegelStand(
        { beendet: false, letzter_abgleich_at: letzter },
        true,
        letzterMs + 20_000,
        zeit,
      ),
    ).toEqual({ text: `Abgleich [${letzter}]`, gestoert: false });
  });

  it('„keine Verbindung seit 10 min“, wenn der Abgleich ausbleibt (Szenario „Leitung weg“)', () => {
    expect(
      spiegelStand(
        { beendet: false, letzter_abgleich_at: letzter },
        true,
        letzterMs + 10 * 60_000,
        zeit,
      ),
    ).toEqual({ text: 'keine Verbindung seit 10 min', gestoert: true });
    // Knapp über der Grenze, aber unter einer Minute Anzeige: dennoch kein „gerade eben“.
    expect(KEINE_VERBINDUNG_AB_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('meldet keine Störung im abgeschlossenen Einsatz (Takt der Meldung) und nach dem Ende', () => {
    expect(
      spiegelStand(
        { beendet: false, letzter_abgleich_at: letzter },
        false,
        letzterMs + 10 * 60_000,
        zeit,
      ).gestoert,
    ).toBe(false);
    expect(
      spiegelStand({ beendet: true, letzter_abgleich_at: letzter }, true, letzterMs + 9e6, zeit),
    ).toEqual({ text: 'Abgleich beendet', gestoert: false });
  });

  it('vor dem ersten Abgleich', () => {
    expect(spiegelStand({ beendet: false }, true, letzterMs, zeit)).toEqual({
      text: 'noch kein Abgleich',
      gestoert: true,
    });
  });

  it('zählt ausstehende und abgelehnte Anträge, ohne Anträge nichts', () => {
    expect(antragZaehler({ antraege_ausstehend: 0, antraege_abgelehnt: 0 })).toEqual([]);
    expect(antragZaehler({ antraege_ausstehend: 1, antraege_abgelehnt: 0 })).toEqual([
      '1 Antrag ausstehend',
    ]);
    expect(antragZaehler({ antraege_ausstehend: 3, antraege_abgelehnt: 2 })).toEqual([
      '3 Anträge ausstehend',
      '2 abgelehnt',
    ]);
  });

  it('liest die erfassten Daten ohne Kennungen', () => {
    expect(
      antragDatenText({
        art: 'etb',
        daten: { von: 'ELW', inhalt: 'Lage  ruhig\nweiter' } as never,
      }),
    ).toBe('ELW: Lage ruhig weiter');
    expect(antragDatenText({ art: 'stand', daten: { evakuiert: 12 } as never })).toBe(
      '12 evakuiert',
    );
    expect(
      antragDatenText({ art: 'eintreffen', daten: { kraft: { objekt_id: 9 } } as never }),
    ).toBe('Kraft');
  });

  it('nennt auch Einträge an Personen, Registrierung, Abmeldung und Eintreffen', () => {
    const text = (art: string, daten: Record<string, unknown>) =>
      antragDatenText({ art, daten: daten as never });
    expect(text('sichtung', { kategorie: 'sk1' })).toBe('Sichtung SK I');
    expect(text('massnahme', { art: 'zugang' })).toMatch(/^Maßnahme /);
    expect(text('anlass', { anlass: null })).toBe('Anlass aufgehoben');
    expect(text('verbleib', { art: 'entlassung' })).toMatch(/^Verbleib /);
    expect(
      text('registrierung', { personen: [{ name: 'Weber', vorname: 'Anna' }, { name: 'Weber' }] }),
    ).toBe('2 Personen: Weber, Anna; Weber');
    expect(text('abmeldung', { haushalt_id: 903 })).toBe('Haushalt');
    expect(text('abmeldung', { person_ids: [1, 2] })).toBe('2 Personen');
    expect(text('eintreffen', { unangemeldet: { fahrzeuge: [] } })).toBe('unangemeldete Kraft');
    expect(text('eintreffen', { kraft: { objekt_typ: 'einheit', objekt_id: 9 } })).toBe('Kraft');
    // Unlesbare Daten ergeben nichts statt eines Fehlers.
    expect(text('sichtung', { kategorie: 'xx' })).toBe('');
  });

  it('führt „Neu erfassen“ an den Ort der Erfassung, mit lokalem Ziel', () => {
    expect(antragErfassungsort(7, { art: 'etb', ziel: {} as never })).toBe(
      '/einsaetze/7/etb?neu=1',
    );
    expect(antragErfassungsort(7, { art: 'sichtung', ziel: { pid: 12 } as never })).toBe(
      '/einsaetze/7/personen/12',
    );
    expect(antragErfassungsort(7, { art: 'notiz', ziel: {} as never })).toBeNull();
  });
});

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
