import { describe, expect, it } from 'vitest';
import type { EinsatzAnzeige, Person, Stab } from '../api/types';
import { baueLagebild, type Rohdaten } from '../pages/lage-dashboard/lagebild';
import {
  quellenLaden,
  vorbereitungMarkdown,
  vorbereitungsZeilen,
  type VorbereitungsQuellen,
} from './vorbereitung';

const BERLIN = { zeitzone: 'Europe/Berlin' };
const JETZT = Date.UTC(2026, 5, 11, 12, 0, 0);

const person = (p: Partial<Person>) =>
  ({ status: 'erfasst', aktuelle_sichtung: null, ...p }) as Person;

const roh = (over: Partial<Rohdaten> = {}): Rohdaten => ({
  einsatz: {
    id: 1,
    bezeichnung: 'Hochwasser',
    begonnen_at: '2026-06-11 05:19:00',
    abgeschlossen_at: null,
    status: 'aktiv',
    lagekennzahlen: [],
  } as unknown as EinsatzAnzeige,
  personen: [
    person({ aktuelle_sichtung: 'sk1' }),
    person({ aktuelle_sichtung: 'sk3' }),
    person({ status: 'vermisst', erfasst_at: '2026-06-11 11:00:00' }),
  ],
  uhs: [],
  schaeden: [],
  gefahren: [
    { id: 1, hoechste_warnstufe: 'hoch' },
    { id: 2, hoechste_warnstufe: 'keine' },
  ] as unknown as Rohdaten['gefahren'],
  lageberichte: [],
  einheiten: [],
  personal: [
    { id: 1, staerke_position: 'fuehrer', status_kategorie: 'verfuegbar' },
    { id: 2, staerke_position: 'mannschaft', status_kategorie: 'verfuegbar' },
  ] as unknown as Rohdaten['personal'],
  fahrzeuge: [],
  material: [],
  abschnitte: [],
  pegel: [],
  evakuierung: { zustand: 'laden' },
  ...over,
});

const alleDa = {
  personen: 'daten',
  kraefte: 'daten',
  gefahren: 'daten',
  lageberichte: 'daten',
  stab: 'daten',
} as const;

const stab = {
  anzahl_lagebesprechungen: 3,
  besetzung: [],
  letzte_lagebesprechung: {
    id: 3,
    lfd_nr: 3,
    einsatz_id: 1,
    abgehalten_at: '2026-06-11 11:30:00',
    entschluss: 'x',
    erfasst_at: '2026-06-11 11:31:00',
    erfasst_von_id: 1,
    etb_eintrag_id: 9,
  },
  naechste_lagebesprechung_at: '2026-06-11 12:30:00',
} as Stab;

function quellen(over: Partial<VorbereitungsQuellen> = {}): VorbereitungsQuellen {
  return {
    lagebild: baueLagebild(roh(), JETZT, BERLIN),
    zustand: alleDa,
    auftraege: { zustand: 'daten', zahl: { offen: 5, in_arbeit: 2, ueberfaellig: 1 } },
    meldungen: { zustand: 'daten', zahl: { offen: 3, ungesehen: 1, bestaetigung_ueberfaellig: 0 } },
    stab,
    ...over,
  };
}

const zeile = (zeilen: ReturnType<typeof vorbereitungsZeilen>, schluessel: string) =>
  zeilen.find((z) => z.schluessel === schluessel)!;

describe('vorbereitungsZeilen (LFH-550)', () => {
  it('zeigt dieselben Werte wie das Lagebild des Dashboards — rechnet keine eigene Zahl', () => {
    const lagebild = baueLagebild(roh(), JETZT, BERLIN);
    const zeilen = vorbereitungsZeilen(quellen({ lagebild }), BERLIN);
    const imBand = (e: string) => lagebild.kennzahlen.find((k) => k.etikett === e)!;
    expect(zeile(zeilen, 'betroffene').wert).toBe(imBand('Betroffene').wert);
    expect(zeile(zeilen, 'vermisste').wert).toBe(imBand('Vermisste').wert);
    expect(zeile(zeilen, 'kraefte').wert).toBe(imBand('Kräfte').wert);
    expect(zeile(zeilen, 'kraefte').notiz).toBe(imBand('Kräfte').notiz);
    expect(zeile(zeilen, 'betroffene').wert).toBe('3');
    expect(zeile(zeilen, 'kraefte').wert).toBe('2');
    expect(zeile(zeilen, 'sichtung').wert).toBe(
      'SK I 1 · SK II 0 · SK III 1 · SK IV 0 · ohne Sichtung 1',
    );
    expect(zeile(zeilen, 'warnstufe')).toMatchObject({
      wert: 'hoch',
      notiz: '1 Gebiet mit Warnstufe',
    });
  });

  it('Aufträge und Meldungen aus dem Modulzähler, mit dem Wortlaut des Führungsstands', () => {
    const zeilen = vorbereitungsZeilen(quellen(), BERLIN);
    expect(zeile(zeilen, 'auftraege')).toMatchObject({ wert: '5', notiz: '1 überfällig' });
    expect(zeile(zeilen, 'meldungen')).toMatchObject({ wert: '3', notiz: '1 neu' });
  });

  it('feste Reihenfolge wie das Dashboard, jede Zeile mit Quelle', () => {
    const zeilen = vorbereitungsZeilen(quellen(), BERLIN);
    expect(zeilen.map((z) => z.schluessel)).toEqual([
      'betroffene',
      'vermisste',
      'sichtung',
      'kraefte',
      'warnstufe',
      'auftraege',
      'meldungen',
      'lagebericht',
      'besprechung',
      'termin',
    ]);
    expect(zeilen.map((z) => z.quelle)).toEqual([
      'Personen',
      'Personen',
      'Personen',
      'Meldebild',
      'Gefahren',
      'Aufträge/Befehle',
      'Meldungen (eingehend)',
      'Lageberichte',
      'Stab',
      'Stab',
    ]);
  });

  it('Betroffene gesperrt: „—“ mit Grund, nie 0; die übrigen Zeilen bleiben', () => {
    const zeilen = vorbereitungsZeilen(
      quellen({ zustand: { ...alleDa, personen: 'gesperrt' } }),
      BERLIN,
    );
    for (const s of ['betroffene', 'vermisste', 'sichtung']) {
      expect(zeile(zeilen, s)).toMatchObject({
        wert: '—',
        notiz: 'nicht freigegeben',
        zustand: 'gesperrt',
      });
    }
    expect(zeile(zeilen, 'kraefte').wert).toBe('2');
  });

  it('ein Modul fehlt im Zähler: „nicht freigegeben“', () => {
    const zeilen = vorbereitungsZeilen(quellen({ meldungen: { zustand: 'gesperrt' } }), BERLIN);
    expect(zeile(zeilen, 'meldungen')).toMatchObject({ wert: '—', notiz: 'nicht freigegeben' });
  });

  it('ohne Lagebild lädt jede Zeile — und die Übernahme wartet', () => {
    const zeilen = vorbereitungsZeilen(quellen({ lagebild: null }), BERLIN);
    expect(zeilen.every((z) => z.zustand === 'laden' && z.wert === '—')).toBe(true);
    expect(quellenLaden(zeilen)).toBe(true);
    expect(quellenLaden(vorbereitungsZeilen(quellen(), BERLIN))).toBe(false);
  });

  it('letzte Besprechung und nächster Termin aus dem Stab', () => {
    const zeilen = vorbereitungsZeilen(quellen(), BERLIN);
    expect(zeile(zeilen, 'besprechung')).toMatchObject({ wert: 'Nr. 3' });
    expect(zeile(zeilen, 'besprechung').notiz).toContain('abgehalten');
    expect(zeile(zeilen, 'termin').wert).not.toBe('kein Termin');
    const ohne = vorbereitungsZeilen(
      quellen({
        stab: { ...stab, letzte_lagebesprechung: null, naechste_lagebesprechung_at: null },
      }),
      BERLIN,
    );
    expect(zeile(ohne, 'besprechung').wert).toBe('keine');
    expect(zeile(ohne, 'termin').wert).toBe('kein Termin');
  });
});

describe('vorbereitungMarkdown', () => {
  it('Stand, Quelle je Zeile, fehlende Quelle mit Grund, Herkunftszeile; Titel maskiert', () => {
    const text = vorbereitungMarkdown(
      [
        {
          schluessel: 'a',
          titel: 'Betroffene',
          wert: '3',
          notiz: '2 Patienten',
          quelle: 'Personen',
          zustand: 'daten',
        },
        {
          schluessel: 'b',
          titel: 'Meldungen offen',
          wert: '—',
          notiz: 'nicht freigegeben',
          quelle: 'Meldungen (eingehend)',
          zustand: 'gesperrt',
        },
        {
          schluessel: 'c',
          titel: 'Letzter Lagebericht',
          wert: '11:30',
          notiz: 'Entwurf · Lage *Nord* [2]',
          quelle: 'Lageberichte',
          zustand: 'daten',
        },
      ],
      '111400JUN2026',
    );
    expect(text).toBe(
      [
        '# Vorbereitung Lagebesprechung',
        '',
        '**Stand:** 111400JUN2026',
        '',
        '- **Betroffene:** 3 (2 Patienten) — Quelle: Personen',
        '- **Meldungen offen:** — (nicht freigegeben) — Quelle: Meldungen (eingehend)',
        '- **Letzter Lagebericht:** 11:30 (Entwurf · Lage \\*Nord\\* \\[2\\]) — Quelle: Lageberichte',
        '',
        '_Zusammengestellt aus den Modulen des Einsatzes; keine Vortragsgliederung._',
        '',
      ].join('\n'),
    );
  });
});
