import { describe, expect, it } from 'vitest';
import {
  KEINE_VERBINDUNG_AB_MS,
  antragDatenText,
  antragEinsatzText,
  antragKopierText,
  antragErfassungsort,
  antragZaehler,
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

  it('kürzt Freitexte nur im Band, nicht mit voll (LLH-1648)', () => {
    const inhalt = 'x'.repeat(100);
    expect(antragDatenText({ art: 'notiz', daten: { text: inhalt } as never })).toBe(
      `${'x'.repeat(80)} …`,
    );
    expect(
      antragDatenText({ art: 'notiz', daten: { text: inhalt } as never }, { voll: true }),
    ).toBe(inhalt);
  });

  it('nennt den verwahrten Einsatz mit Nummer und Stichwort und kopiert den Antrag (LLH-1648)', () => {
    const antrag = {
      id: 4,
      einsatz_id: 7,
      einsatznummer: 'E-2026-0042',
      stichwort: 'RD 1',
      art: 'etb',
      grund: 'Einsatz abgeschlossen.',
      erfasst_at: '2026-11-10 13:30:00',
      frist_bis: '2026-12-11 08:00:00',
      daten: { von: 'UHS', inhalt: 'Patient übergeben' } as never,
    };
    expect(antragEinsatzText(antrag)).toBe('E-2026-0042 · RD 1');
    expect(antragEinsatzText({ ...antrag, stichwort: undefined })).toBe('E-2026-0042');
    expect(antragEinsatzText({ ...antrag, einsatznummer: undefined, stichwort: undefined })).toBe(
      '#7',
    );
    expect(antragKopierText(antrag, (w) => `<${w}>`)).toBe(
      [
        'Antrag: ETB-Eintrag',
        'Einsatz: E-2026-0042 · RD 1',
        'Erfasst: <2026-11-10 13:30:00>',
        'Daten: UHS: Patient übergeben',
        'Grund: Einsatz abgeschlossen.',
      ].join('\n'),
    );
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
