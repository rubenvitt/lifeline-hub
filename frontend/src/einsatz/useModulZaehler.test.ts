import { describe, expect, it } from 'vitest';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import { modulRegistry } from './modulRegistry';
import { bildeZaehler, darfZaehlerZeigen, ZAEHLER_QUELLEN } from './useModulZaehler';

const benutzer: BenutzerAnzeige = {
  id: 1,
  anzeigename: 'E',
  benutzername: 'e',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-08-06 10:00:00',
  totp_aktiviert: false,
};

describe('Modul-Zähler', () => {
  // Bis LFH-612 rechnete der Browser diese Zahlen aus vollen Listen; die Wortlaute sind seither
  // dieselben, nur die Eingabe kommt vom Server. Die Paare (Mehrzahl / Einzahl) bleiben.
  it('bildet die Kommunikationszähler mit dem bisherigen Wortlaut ab', () => {
    expect(
      bildeZaehler({
        meldungen: { offen: 2, ungesehen: 1 },
        auftraege: { offen: 2, ueberfaellig: 1 },
        erinnerungen: { faellig: 1 },
        chat: { ungelesen: 5 },
      }),
    ).toEqual({
      meldungen: { wert: 2, beschreibung: '2 offene Meldungen, davon 1 ungesehen' },
      auftraege: { wert: 2, beschreibung: '2 offene Aufträge, davon 1 überfällig' },
      erinnerungen: { wert: 1, beschreibung: '1 fällige Erinnerung' },
      chat: { wert: 5, beschreibung: '5 ungelesene Chat-Nachrichten' },
    });
    expect(
      bildeZaehler({
        meldungen: { offen: 1, ungesehen: 0 },
        auftraege: { offen: 1, ueberfaellig: 0 },
        erinnerungen: { faellig: 2 },
        chat: { ungelesen: 1 },
      }),
    ).toEqual({
      meldungen: { wert: 1, beschreibung: '1 offene Meldung, davon 0 ungesehen' },
      auftraege: { wert: 1, beschreibung: '1 offener Auftrag, davon 0 überfällig' },
      erinnerungen: { wert: 2, beschreibung: '2 fällige Erinnerungen' },
      chat: { wert: 1, beschreibung: '1 ungelesene Chat-Nachricht' },
    });
  });

  it('bildet die Gesamtmengen mit Einzahl und Mehrzahl ab', () => {
    expect(
      bildeZaehler({
        etb: { gesamt: 412 },
        personen: { gesamt: 248 },
        einheiten: { gesamt: 31 },
        einsatzabschnitte: { gesamt: 4 },
      }),
    ).toEqual({
      etb: { wert: 412, beschreibung: '412 Einträge im Einsatztagebuch' },
      personen: { wert: 248, beschreibung: '248 Betroffene' },
      einheiten: { wert: 31, beschreibung: '31 Einheiten' },
      einsatzabschnitte: { wert: 4, beschreibung: '4 Einsatzabschnitte' },
    });
    expect(
      bildeZaehler({
        etb: { gesamt: 1 },
        personen: { gesamt: 1 },
        einheiten: { gesamt: 1 },
        einsatzabschnitte: { gesamt: 1 },
      }),
    ).toEqual({
      etb: { wert: 1, beschreibung: '1 Eintrag im Einsatztagebuch' },
      personen: { wert: 1, beschreibung: '1 betroffene Person' },
      einheiten: { wert: 1, beschreibung: '1 Einheit' },
      einsatzabschnitte: { wert: 1, beschreibung: '1 Einsatzabschnitt' },
    });
  });

  it('lässt ein fehlendes Feld fehlen, statt es zu 0 zu machen', () => {
    const karte = bildeZaehler({ personen: { gesamt: 0 } });
    expect(karte).toEqual({ personen: { wert: 0, beschreibung: '0 Betroffene' } });
    expect('meldungen' in karte).toBe(false);
  });

  it('jede Quelle hängt an genau einem Modul der Registry', () => {
    for (const quelle of ZAEHLER_QUELLEN) {
      expect(modulRegistry.filter((m) => m.zaehlerQuelle === quelle)).toHaveLength(1);
    }
  });

  it('zeigt keine Zähler an ausgeblendeten oder rollen-gesperrten Modulen', () => {
    const versteckt: ModulOverrides = {
      meldungen: {
        einsatz_id: 7,
        modul_key: 'meldungen',
        sichtbar: false,
        benoetigte_rolle: null,
        geaendert_at: null,
        geaendert_von: null,
      },
    };
    expect(darfZaehlerZeigen('meldungen', benutzer, versteckt)).toBe(false);

    const gesperrt: ModulOverrides = {
      chat: {
        einsatz_id: 7,
        modul_key: 'chat',
        sichtbar: true,
        benoetigte_rolle: 'fuehrungskraft',
        geaendert_at: null,
        geaendert_von: null,
      },
    };
    expect(darfZaehlerZeigen('chat', benutzer, gesperrt)).toBe(false);
    expect(darfZaehlerZeigen('erinnerungen', benutzer)).toBe(true);
  });
});
