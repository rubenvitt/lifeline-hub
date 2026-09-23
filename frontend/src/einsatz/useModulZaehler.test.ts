import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import {
  berechneAbloesungZaehler,
  berechneAuftragsZaehler,
  berechneChatZaehler,
  berechneErinnerungsZaehler,
  berechneMeldungsZaehler,
  darfZaehlerLaden,
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
  it('berechnet die fachlichen Haupt- und Teilmengen', () => {
    expect(
      berechneMeldungsZaehler([
        { ist_offen: true, status: 'neu' },
        { ist_offen: true, status: 'gesichtet' },
        { ist_offen: false, status: 'erledigt' },
      ]),
    ).toEqual({ wert: 2, beschreibung: '2 offene Meldungen, davon 1 ungesehen' });

    expect(
      berechneAuftragsZaehler([
        { bearbeitungsstatus: 'offen', ist_ueberfaellig: true },
        { bearbeitungsstatus: 'in_arbeit', ist_ueberfaellig: false },
        { bearbeitungsstatus: 'abgenommen', ist_ueberfaellig: true },
      ]),
    ).toEqual({ wert: 2, beschreibung: '2 offene Aufträge, davon 1 überfällig' });

    expect(
      berechneErinnerungsZaehler([
        { status: 'offen', ist_faellig: true },
        { status: 'quittiert', ist_faellig: true },
      ]),
    ).toEqual({ wert: 1, beschreibung: '1 fällige Erinnerung' });

    expect(berechneChatZaehler([{ ungelesen_anzahl: 2 }, { ungelesen_anzahl: 3 }])).toEqual({
      wert: 5,
      beschreibung: '5 ungelesene Chat-Nachrichten',
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

  it('lädt keine Zähler für ausgeblendete oder rollen-gesperrte Module', () => {
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
    expect(darfZaehlerLaden('meldungen', benutzer, versteckt)).toBe(false);

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
    expect(darfZaehlerLaden('chat', benutzer, gesperrt)).toBe(false);
    expect(darfZaehlerLaden('erinnerungen', benutzer)).toBe(true);
  });
});
