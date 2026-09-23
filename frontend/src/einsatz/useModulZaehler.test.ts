import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import { modulRegistry } from './modulRegistry';
import {
  berechneAbloesungZaehler,
  berechneBetreuungZaehler,
  berechneDokumentZaehler,
  bildeZaehler,
  darfZaehlerZeigen,
  ZAEHLER_QUELLEN,
} from './useModulZaehler';

dayjs.extend(utc);

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

    expect(berechneDokumentZaehler([{}, {}, {}])).toEqual({
      wert: 3,
      beschreibung: '3 abgelegte Dokumente',
    });
    expect(berechneDokumentZaehler([{}])).toEqual({
      wert: 1,
      beschreibung: '1 abgelegtes Dokument',
    });
  });

  it('zählt Ablösungen in der Vorwarnzeit oder überfällig (LFH-635)', () => {
    const schicht = (id: number, faellig_at: string) => ({
      id,
      einsatz_id: 1,
      einheit_id: id,
      einheit_name: `F${id}`,
      beginn_at: '2026-09-22 09:00:00',
      rhythmus_minuten: 360,
      rhythmus_quelle: 'einheit' as const,
      faellig_at,
      status: 'laufend' as const,
      ruecknehmbar: false,
      angelegt_at: '2026-09-22 09:00:00',
    });
    expect(
      berechneAbloesungZaehler(
        [
          schicht(1, '2026-09-22 15:00:00'),
          schicht(2, '2026-09-22 15:30:00'),
          schicht(3, '2026-09-22 18:10:00'),
        ],
        dayjs.utc('2026-09-22 15:10:00'),
      ),
    ).toEqual({ wert: 2, beschreibung: '2 Ablösungen fällig oder in den nächsten 30 min' });
  });

  it('zählt die aktiven Evakuierungsbezirke — ohne aufgehobene und stornierte (LFH-639)', () => {
    const bezirk = (
      id: number,
      raeumung: 'angeordnet' | 'laeuft' | 'geraeumt' | 'aufgehoben',
      storniert_at?: string,
    ) => ({ id, raeumung, storniert_at });
    expect(
      berechneBetreuungZaehler([
        bezirk(1, 'angeordnet'),
        bezirk(2, 'laeuft'),
        bezirk(3, 'geraeumt'),
        bezirk(4, 'aufgehoben'),
        // Die Übersicht liefert keine stornierten; eine Mutationsantwort im Cache könnte.
        bezirk(5, 'angeordnet', '2026-09-23 10:00:00'),
      ]),
    ).toEqual({ wert: 3, beschreibung: '3 aktive Evakuierungsbezirke' });
    expect(berechneBetreuungZaehler([bezirk(1, 'laeuft')])).toEqual({
      wert: 1,
      beschreibung: '1 aktiver Evakuierungsbezirk',
    });
    expect(berechneBetreuungZaehler([])).toEqual({
      wert: 0,
      beschreibung: '0 aktive Evakuierungsbezirke',
    });
  });

  it('zeigt den Betreuungszähler nur bei sichtbarem Modul (LFH-639)', () => {
    expect(darfZaehlerZeigen('betreuung', benutzer)).toBe(true);
    const versteckt: ModulOverrides = {
      betreuung: {
        einsatz_id: 7,
        modul_key: 'betreuung',
        sichtbar: false,
        benoetigte_rolle: null,
        geaendert_at: null,
        geaendert_von: null,
      },
    };
    expect(darfZaehlerZeigen('betreuung', benutzer, versteckt)).toBe(false);
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
