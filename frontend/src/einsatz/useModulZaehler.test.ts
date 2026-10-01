import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { modulRegistry } from './modulRegistry';
import {
  berechneAbloesungZaehler,
  berechneBetreuungZaehler,
  berechneDokumentZaehler,
  berechneUnwetterZaehler,
  bildeZaehler,
  darfZaehlerZeigen,
  ZAEHLER_QUELLEN,
} from './useModulZaehler';
import { freigabenFixture } from '../test/fixtures';

dayjs.extend(utc);

describe('Modul-Zähler', () => {
  // Die Zahlen kommen vom Server; die Wortlaute (Mehrzahl / Einzahl) bleiben die der Liste.
  it('bildet die Kommunikationszähler mit dem bisherigen Wortlaut ab', () => {
    expect(
      bildeZaehler({
        meldungen: { offen: 2, ungesehen: 1, bestaetigung_ueberfaellig: 0 },
        auftraege: { offen: 2, in_arbeit: 0, ueberfaellig: 1 },
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
        meldungen: { offen: 1, ungesehen: 0, bestaetigung_ueberfaellig: 0 },
        auftraege: { offen: 1, in_arbeit: 0, ueberfaellig: 0 },
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
    expect(darfZaehlerZeigen('betreuung', freigabenFixture())).toBe(true);
    const versteckt = freigabenFixture({ betreuung: { sichtbar: false, zugriff: false } });
    expect(darfZaehlerZeigen('betreuung', versteckt)).toBe(false);
  });

  it('zählt Unwetterwarnungen am Einsatzort — nur schwer/extrem, nie 0 ohne Stand (LFH-663)', () => {
    const jetzt = Date.UTC(2026, 8, 22, 12, 30);
    const um = (ms: number) => new Date(jetzt + ms).toISOString();
    const h = 3_600_000;
    const w = (stufe: 'gering' | 'maessig' | 'schwer' | 'extrem', beginn: number) => ({
      stufe,
      ereignis: 'X',
      ueberschrift: 'X',
      beginn: um(beginn),
      ende: um(beginn + 3 * h),
    });
    const teil = (daten: ReturnType<typeof w>[], alter = 60_000) => ({
      zustand: 'ok' as const,
      abgerufen_at: um(-alter),
      daten,
    });
    expect(
      berechneUnwetterZaehler(teil([w('schwer', -h), w('extrem', 2 * h), w('maessig', -h)]), jetzt),
    ).toEqual({
      wert: 2,
      beschreibung: '2 Unwetterwarnungen für den Einsatzort, davon 1 angekündigt',
    });
    expect(berechneUnwetterZaehler(teil([w('schwer', -h)]), jetzt)).toEqual({
      wert: 1,
      beschreibung: '1 Unwetterwarnung für den Einsatzort',
    });
    expect(berechneUnwetterZaehler(teil([w('gering', -h)]), jetzt)).toEqual({
      wert: 0,
      beschreibung: '0 Unwetterwarnungen für den Einsatzort',
    });
    // Stand unbekannt / kein Ort: keine Zahl, auch keine 0.
    expect(berechneUnwetterZaehler(teil([w('schwer', -h)], 7 * h), jetzt)).toBeUndefined();
    expect(berechneUnwetterZaehler({ zustand: 'kein_ort' }, jetzt)).toBeUndefined();
  });

  it('der Unwetterzähler hängt am Modul „Wetter & Pegel" (LFH-663)', () => {
    expect(modulRegistry.find((m) => m.zaehlerQuelle === 'wetter-pegel')?.key).toBe('wetter-pegel');
    expect(darfZaehlerZeigen('wetter-pegel', freigabenFixture())).toBe(true);
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

  it('zeigt keine Zähler an ausgeblendeten oder vom Server gesperrten Modulen (LFH-669)', () => {
    const versteckt = freigabenFixture({ meldungen: { sichtbar: false, zugriff: false } });
    expect(darfZaehlerZeigen('meldungen', versteckt)).toBe(false);

    const gesperrt = freigabenFixture({ chat: { zugriff: false } });
    expect(darfZaehlerZeigen('chat', gesperrt)).toBe(false);
    expect(darfZaehlerZeigen('erinnerungen', gesperrt)).toBe(true);

    // Ausgeblendet, aber erreichbar (System-Admin): die Navigation zeigt das Modul nicht, also
    // auch keinen Zähler daran.
    const adminAusgeblendet = freigabenFixture({ meldungen: { sichtbar: false, zugriff: true } });
    expect(darfZaehlerZeigen('meldungen', adminAusgeblendet)).toBe(false);
  });

  it('gibt bei unbekannten Freigaben keinen Zähler frei — sie sind das Ladegate (LFH-669)', () => {
    for (const quelle of ZAEHLER_QUELLEN) {
      expect(darfZaehlerZeigen(quelle, undefined), quelle).toBe(false);
    }
    // Ein Modul, das in der Antwort fehlt, ist ebenso unbekannt.
    expect(darfZaehlerZeigen('chat', {})).toBe(false);
  });
});
