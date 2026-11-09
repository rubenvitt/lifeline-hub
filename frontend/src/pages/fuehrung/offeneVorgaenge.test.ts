import { describe, expect, it } from 'vitest';
import type {
  Abloesung,
  Auftrag,
  EinsatzAnzeige,
  Erinnerung,
  Meldung,
  Nachforderung,
} from '../../api/types';
import {
  auftragFuerMich,
  erinnerungFuerMich,
  meineStelle,
  meldungFuerMich,
  nachSicht,
  listenStand,
  nachforderungFuerMich,
  sichtAusUrl,
  vorgangsAbloesungen,
  vorgangsErinnerungen,
  vorgangsMeldungen,
  vorgangsNachforderungen,
} from './offeneVorgaenge';

const JETZT = Date.UTC(2026, 8, 13, 12, 0);
const um = (h: number, m: number) =>
  `2026-09-13 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

const meldung = (over: Partial<Meldung>): Meldung =>
  ({
    id: 1,
    status: 'gesichtet',
    ist_offen: true,
    bestaetigung_pflicht: false,
    ist_bestaetigt: false,
    ist_ueberfaellig: false,
    eskaliert: false,
    eingang_at: um(11, 0),
    erfasst_von_id: 9,
    empfaenger_funktion: null,
    ...over,
  }) as Meldung;

const nf = (over: Partial<Nachforderung>): Nachforderung =>
  ({
    id: 1,
    status: 'angefordert',
    angefordert_at: um(10, 0),
    erstellt_von_id: 9,
    eintreffen_erwartet_at: undefined,
    benoetigt_bis: undefined,
    ...over,
  }) as Nachforderung;

const erinnerung = (over: Partial<Erinnerung>): Erinnerung =>
  ({
    id: 1,
    status: 'offen',
    ist_faellig: false,
    faellig_at: um(12, 10),
    erstellt_von_id: 9,
    empfaenger_funktion_code: null,
    ...over,
  }) as Erinnerung;

const schicht = (over: Partial<Abloesung>): Abloesung =>
  ({
    id: 1,
    status: 'laufend',
    faellig_at: um(12, 20),
    vorwarnung_minuten: 30,
    ...over,
  }) as Abloesung;

describe('Folge je Abschnitt (LLH-1145)', () => {
  it('Meldungen: Bestätigung überfällig → neu → älteste; erledigte fehlen', () => {
    const liste = vorgangsMeldungen([
      meldung({ id: 1, eingang_at: um(9, 0) }),
      meldung({ id: 2, status: 'neu', eingang_at: um(11, 30) }),
      meldung({
        id: 3,
        bestaetigung_pflicht: true,
        ist_ueberfaellig: true,
        eingang_at: um(11, 50),
      }),
      meldung({ id: 4, status: 'neu', eingang_at: um(10, 0) }),
      meldung({ id: 5, status: 'erledigt', ist_offen: false, eingang_at: um(8, 0) }),
    ]);
    expect(liste.map((m) => m.id)).toEqual([3, 4, 2, 1]);
  });

  it('Nachforderungen: überfällig → Bedarfszeit → älteste; abgeschlossene fehlen', () => {
    const liste = vorgangsNachforderungen(
      [
        nf({ id: 1, angefordert_at: um(8, 0) }),
        nf({ id: 2, angefordert_at: um(11, 0), benoetigt_bis: um(13, 0) }),
        nf({ id: 3, status: 'unterwegs', eintreffen_erwartet_at: um(11, 30) }),
        nf({ id: 4, status: 'eingetroffen', angefordert_at: um(7, 0) }),
        nf({ id: 5, angefordert_at: um(9, 0) }),
      ],
      JETZT,
    );
    expect(liste.map((n) => n.id)).toEqual([3, 2, 1, 5]);
  });

  it('Erinnerungen: fällige und die in 30 min, früheste zuerst', () => {
    const liste = vorgangsErinnerungen(
      [
        erinnerung({ id: 1, faellig_at: um(12, 30) }),
        erinnerung({ id: 2, faellig_at: um(12, 31) }),
        erinnerung({ id: 3, faellig_at: um(11, 0), ist_faellig: true }),
        erinnerung({ id: 4, faellig_at: um(11, 30), status: 'erledigt', ist_faellig: true }),
      ],
      JETZT,
    );
    expect(liste.map((e) => e.id)).toEqual([3, 1]);
  });

  it('Ablösungen: überfällig oder in der Vorwarnzeit, früheste zuerst', () => {
    const liste = vorgangsAbloesungen(
      [
        schicht({ id: 1, faellig_at: um(12, 20) }),
        schicht({ id: 2, faellig_at: um(13, 0) }),
        schicht({ id: 3, faellig_at: um(11, 50) }),
        schicht({ id: 4, faellig_at: um(11, 0), status: 'abgeloest' }),
      ],
      JETZT,
    );
    expect(liste.map((a) => a.id)).toEqual([3, 1]);
  });
});

describe('Meine Stelle (LLH-1145 D5, pkjvl5iy)', () => {
  it('eigene Funktion ist der Code aus dem Einsatzkopf, nicht das Sachgebiet', () => {
    const s7 = meineStelle({ meine_funktion_code: 's7' }, 1);
    expect(s7.funktion).toBe('s7');
    expect(s7.bezeichnung).toBeNull();
    // Den EL-Fallback leitet das Backend ab (`funktion::ableiten`); das Frontend liest nur.
    expect(meineStelle({ meine_funktion_code: 'el' }, 1).funktion).toBe('el');
    // Ein Kopf nur mit Sachgebiet (etwa ein alter Offline-Stand) ergibt keine Funktion (D3).
    const nurSachgebiet = { meine_sachgebiete: ['s2'] } as unknown as EinsatzAnzeige;
    expect(meineStelle(nurSachgebiet, 1).funktion).toBeNull();
    expect(
      meineStelle({ meine_funktion_code: 'fachberater', meine_funktion_bezeichnung: ' THW ' }, 1)
        .bezeichnung,
    ).toBe(' THW ');
  });

  const s2 = meineStelle({ meine_funktion_code: 's2' }, 7);
  const auftrag = (over: Partial<Auftrag>) =>
    ({ erstellt_von_id: 9, empfaenger: [], ...over }) as unknown as Auftrag;
  const an = (funktion: string, funktion_text?: string | null) =>
    auftrag({ empfaenger: [{ funktion, funktion_text }] as unknown as Auftrag['empfaenger'] });

  it('Empfänger ist eine eigene Funktion oder Absender bin ich', () => {
    expect(meldungFuerMich(meldung({ empfaenger_funktion: 's2' }), s2)).toBe(true);
    expect(meldungFuerMich(meldung({ erfasst_von_id: 7 }), s2)).toBe(true);
    expect(meldungFuerMich(meldung({ empfaenger_funktion: 's4' }), s2)).toBe(false);

    expect(auftragFuerMich(an('s2'), s2)).toBe(true);
    expect(auftragFuerMich(auftrag({ erstellt_von_id: 7 }), s2)).toBe(true);
    expect(auftragFuerMich(auftrag({}), s2)).toBe(false);

    expect(erinnerungFuerMich(erinnerung({ empfaenger_funktion_code: 's2' }), s2)).toBe(true);
    expect(erinnerungFuerMich(erinnerung({}), s2)).toBe(false);

    expect(nachforderungFuerMich(nf({ erstellt_von_id: 7 }), s2)).toBe(true);
    expect(nachforderungFuerMich(nf({}), s2)).toBe(false);
  });

  it('S7 erkennt den Auftrag an S7 (LLH-1606)', () => {
    const s7 = meineStelle({ meine_funktion_code: 's7' }, 7);
    expect(auftragFuerMich(an('s7'), s7)).toBe(true);
    expect(auftragFuerMich(an('s2'), s7)).toBe(false);
    expect(meldungFuerMich(meldung({ empfaenger_funktion: 's7' }), s7)).toBe(true);
    expect(erinnerungFuerMich(erinnerung({ empfaenger_funktion_code: 's7' }), s7)).toBe(true);
  });

  it('Fachberater: die Bezeichnung muss passen, ohne Groß-/Kleinschreibung und Rand', () => {
    const thw = meineStelle(
      { meine_funktion_code: 'fachberater', meine_funktion_bezeichnung: 'THW' },
      7,
    );
    expect(auftragFuerMich(an('fachberater', ' thw '), thw)).toBe(true);
    expect(auftragFuerMich(an('fachberater', 'Polizei'), thw)).toBe(false);
    expect(auftragFuerMich(an('fuehrungshilfspersonal', 'THW'), thw)).toBe(false);
    expect(
      erinnerungFuerMich(
        erinnerung({ empfaenger_funktion_code: 'fachberater', empfaenger_funktion: 'Thw' }),
        thw,
      ),
    ).toBe(true);
    expect(
      erinnerungFuerMich(
        erinnerung({ empfaenger_funktion_code: 'fachberater', empfaenger_funktion: 'Polizei' }),
        thw,
      ),
    ).toBe(false);
  });

  it('fehlt eine Bezeichnung (geschwärzt), genügt der Code', () => {
    const thw = meineStelle(
      { meine_funktion_code: 'fuehrungshilfspersonal', meine_funktion_bezeichnung: 'Lotse' },
      7,
    );
    expect(auftragFuerMich(an('fuehrungshilfspersonal', null), thw)).toBe(true);
    expect(
      erinnerungFuerMich(
        erinnerung({
          empfaenger_funktion_code: 'fuehrungshilfspersonal',
          empfaenger_funktion: null,
        }),
        thw,
      ),
    ).toBe(true);
    const geschwaerzt = meineStelle({ meine_funktion_code: 'fuehrungshilfspersonal' }, 7);
    expect(auftragFuerMich(an('fuehrungshilfspersonal', 'Lotse'), geschwaerzt)).toBe(true);
    expect(auftragFuerMich(an('fachberater', 'Lotse'), geschwaerzt)).toBe(false);
  });

  it('ohne Anmeldung ist nichts „von mir“', () => {
    const niemand = meineStelle(undefined, null);
    expect(meldungFuerMich(meldung({ erfasst_von_id: 7 }), niemand)).toBe(false);
  });

  it('die Sicht filtert nur bei „meine“; die URL kennt nur „meine“', () => {
    expect(nachSicht([1, 2, 3], 'alle', (x) => x === 2)).toEqual([1, 2, 3]);
    expect(nachSicht([1, 2, 3], 'meine', (x) => x === 2)).toEqual([2]);
    expect(sichtAusUrl('meine')).toBe('meine');
    expect(sichtAusUrl('alles')).toBe('alle');
    expect(sichtAusUrl(null)).toBe('alle');
  });
});

describe('listenStand (LLH-1145 D7)', () => {
  const q = (over: Partial<Parameters<typeof listenStand>[1]>) => ({
    isError: false,
    isPending: false,
    fetchStatus: 'idle' as const,
    ...over,
  });
  it('gesperrt vor allem anderen; pausiert ist „ohne Netz“, nicht leer', () => {
    expect(listenStand(false, q({ isError: true }))).toBe('gesperrt');
    expect(listenStand(true, q({ isError: true }))).toBe('fehler');
    expect(listenStand(true, q({ isPending: true, fetchStatus: 'paused' }))).toBe('offline');
    expect(listenStand(true, q({ isPending: true, fetchStatus: 'fetching' }))).toBe('laden');
    expect(listenStand(true, q({}))).toBe('daten');
  });
});
