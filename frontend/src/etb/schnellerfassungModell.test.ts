import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { EtbBaustein } from '../api/types';
import {
  amZeilenanfang,
  atZielFeld,
  baueEintrag,
  einheitAusSchluessel,
  erkenneAtTrigger,
  erkenneSlashTrigger,
  erkenneTypBefehl,
  filterAtEintraege,
  filterSlashEintraege,
  METADATEN_FELDER,
  type MetaFeld,
} from './schnellerfassungModell';
dayjs.extend(utc);

describe('METADATEN_FELDER', () => {
  it('enthält genau die fünf Metadatenfelder in Anzeigereihenfolge', () => {
    expect(METADATEN_FELDER.map((f) => f.feld)).toEqual<MetaFeld[]>([
      'ereigniszeit',
      'von',
      'an',
      'meldeweg',
      'veranlassung',
    ]);
  });

  it('jedes Feld hat Label, Trigger-Keywords und Editor-Typ', () => {
    for (const def of METADATEN_FELDER) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.trigger.length).toBeGreaterThan(0);
      expect(['zeit', 'text', 'meldeweg']).toContain(def.editor);
    }
  });
});

describe('erkenneSlashTrigger', () => {
  it('aktiv, wenn / am Textanfang steht', () => {
    expect(erkenneSlashTrigger('/vo', 3)).toEqual({ aktiv: true, filter: 'vo', start: 0 });
  });

  it('aktiv, wenn / nach Whitespace steht', () => {
    const text = 'Pumpe läuft /zei';
    expect(erkenneSlashTrigger(text, text.length)).toEqual({
      aktiv: true,
      filter: 'zei',
      start: 12,
    });
  });

  it('inaktiv bei / mitten im Wort (z.B. 2/9)', () => {
    expect(erkenneSlashTrigger('2/9', 3)).toEqual({ aktiv: false, filter: '', start: -1 });
  });

  it('inaktiv, wenn zwischen / und Cursor ein Leerzeichen liegt', () => {
    expect(erkenneSlashTrigger('/von bar', 8)).toEqual({ aktiv: false, filter: '', start: -1 });
  });

  it('aktiv bei Caret mitten im Text direkt nach dem Filterwort (vor dem Space)', () => {
    expect(erkenneSlashTrigger('/von bar', 4)).toEqual({ aktiv: true, filter: 'von', start: 0 });
  });

  it('inaktiv ohne / links vom Cursor', () => {
    expect(erkenneSlashTrigger('Lage stabil', 11)).toEqual({ aktiv: false, filter: '', start: -1 });
  });

  it('leerer Filter direkt nach /', () => {
    expect(erkenneSlashTrigger('Lage /', 6)).toEqual({ aktiv: true, filter: '', start: 5 });
  });
});

function baustein(id: number, label: string): EtbBaustein {
  return { id, label, typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: id };
}

describe('filterSlashEintraege', () => {
  const bausteine = [baustein(1, 'Lagemeldung'), baustein(2, 'Bereitstellung')];

  it('ohne Filter: alle Felder + alle Bausteine', () => {
    const r = filterSlashEintraege('', bausteine, []);
    expect(r.felder.map((e) => e.key)).toEqual([
      'ereigniszeit',
      'von',
      'an',
      'meldeweg',
      'veranlassung',
    ]);
    expect(r.bausteine.map((e) => e.label)).toEqual(['Lagemeldung', 'Bereitstellung']);
  });

  it('filtert Felder per Trigger-Stichwort (case-insensitive)', () => {
    const r = filterSlashEintraege('ZEI', bausteine, []);
    expect(r.felder.map((e) => e.key)).toEqual(['ereigniszeit']);
    expect(r.bausteine).toEqual([]);
  });

  it('filtert Bausteine per Label-Teilstring', () => {
    const r = filterSlashEintraege('lage', bausteine, []);
    expect(r.bausteine.map((e) => e.label)).toEqual(['Lagemeldung']);
  });

  it('markiert bereits gesetzte Felder', () => {
    const r = filterSlashEintraege('von', bausteine, ['von']);
    expect(r.felder[0]).toMatchObject({ key: 'von', gesetzt: true });
  });
});

describe('baueEintrag', () => {
  const jetztIso = '2026-06-10T12:00:00.000Z';

  it('Standardmeldung: typ + inhalt, ereigniszeit = jetzt (SQLite-UTC), leere Metadaten weggelassen', () => {
    const e = baueEintrag({ inhalt: 'Pumpe läuft', typ: 'meldung', metadaten: {}, jetztIso });
    expect(e).toMatchObject({
      typ: 'meldung',
      inhalt: 'Pumpe läuft',
      ereigniszeit: '2026-06-10 12:00:00',
    });
    expect(e.erfasst_lokal_at).toBe(jetztIso);
    expect(e.von).toBeUndefined();
    expect(e.berichtigt_eintrag_id).toBeUndefined();
  });

  it('übernimmt gesetzte Metadaten inkl. abweichender Ereigniszeit (SQLite-UTC-Format)', () => {
    const e = baueEintrag({
      inhalt: 'Lage',
      typ: 'lage',
      metadaten: {
        von: 'ELW 1',
        an: 'Abschnitt 2',
        meldeweg: 'funk',
        veranlassung: 'RTW nachfordern',
        ereigniszeit: dayjs.utc('2026-06-10 09:30:00'),
      },
      jetztIso,
    });
    expect(e).toMatchObject({
      von: 'ELW 1',
      an: 'Abschnitt 2',
      meldeweg: 'funk',
      veranlassung: 'RTW nachfordern',
      ereigniszeit: '2026-06-10 09:30:00',
    });
  });

  it('Berichtigung: typ=berichtigung + berichtigt_eintrag_id', () => {
    const e = baueEintrag({
      inhalt: 'Korrektur',
      typ: 'meldung',
      metadaten: {},
      berichtigungZuId: 5,
      jetztIso,
    });
    expect(e.typ).toBe('berichtigung');
    expect(e.berichtigt_eintrag_id).toBe(5);
  });

  it('leere Metadaten-Strings werden zu undefined', () => {
    const e = baueEintrag({
      inhalt: 'Pumpe läuft',
      typ: 'meldung',
      metadaten: { von: '', an: '' },
      jetztIso,
    });
    expect(e.von).toBeUndefined();
    expect(e.an).toBeUndefined();
  });
});

describe('Typbefehle (Neuentwurf S4)', () => {
  it('bietet Typen nur auf Wunsch an — und dann als ERSTE Sektion', () => {
    expect(filterSlashEintraege('', [], []).typen).toEqual([]);
    const mit = filterSlashEintraege('an', [], [], { typen: true });
    expect(mit.typen.map((t) => t.key)).toEqual(['anordnung']);
    expect(mit.typen[0]).toEqual({ art: 'typ', key: 'anordnung', label: '/anordnung' });
    // Die Felder bleiben daneben erhalten („An").
    expect(mit.felder.map((f) => f.key)).toContain('an');
  });

  it('erkennt den Zeilenanfang — Textanfang oder nach einem Umbruch', () => {
    expect(amZeilenanfang('/an', 0)).toBe(true);
    expect(amZeilenanfang('Zeile 1\n/an', 8)).toBe(true);
    expect(amZeilenanfang('Lage /an', 5)).toBe(false);
  });

  it('setzt einen ausgetippten Befehl mit Leerzeichen, aber nur exakte Typwörter', () => {
    expect(erkenneTypBefehl('/anordnung Sandsäcke')).toEqual({
      typ: 'anordnung',
      rest: 'Sandsäcke',
    });
    expect(erkenneTypBefehl('/lage ')).toEqual({ typ: 'lage', rest: '' });
    // Kein Leerzeichen: noch nicht fertig getippt.
    expect(erkenneTypBefehl('/lage')).toBeNull();
    // Kein Typ, nur ähnlich — und nicht erfassbar.
    expect(erkenneTypBefehl('/lagebericht x')).toBeNull();
    expect(erkenneTypBefehl('/system x')).toBeNull();
    expect(erkenneTypBefehl('/berichtigung x')).toBeNull();
    // Mitten im Text ist es kein Befehl.
    expect(erkenneTypBefehl('Lage /anordnung x')).toBeNull();
  });
});

describe('@ für Von/An (Neuentwurf S4)', () => {
  it('erkennt @ am Wortanfang, nicht in einer Adresse', () => {
    expect(erkenneAtTrigger('Lage @ELW', 9)).toEqual({ aktiv: true, filter: 'ELW', start: 5 });
    expect(erkenneAtTrigger('mail@example', 12).aktiv).toBe(false);
  });

  it('ordnet bei einer Anordnung den Empfänger zu, sonst den Absender', () => {
    expect(atZielFeld('anordnung')).toBe('an');
    for (const typ of ['meldung', 'lage', 'entscheidung'] as const) {
      expect(atZielFeld(typ)).toBe('von');
    }
  });

  it('beschriftet die Treffer mit dem Zielfeld und bietet Freitext an', () => {
    const namen = ['ELW 1', 'Florian 1', 'Florian 2'];
    const meldung = filterAtEintraege('flo', namen, 'meldung');
    expect(meldung.map((x) => x.label)).toEqual(['Von: Florian 1', 'Von: Florian 2', 'Von: flo']);
    // Exakter Treffer: kein doppelter Freitext-Eintrag.
    expect(filterAtEintraege('ELW 1', namen, 'anordnung').map((x) => x.label)).toEqual([
      'An: ELW 1',
    ]);
    // Leerer Filter: nur die Liste, ohne Freitext.
    expect(filterAtEintraege('', namen, 'lage')).toHaveLength(3);
  });

  it('kehrt den Schlüssel um, auch wenn der Name selbst einen Doppelpunkt trägt', () => {
    expect(einheitAusSchluessel('an:ELW 1')).toEqual({ feld: 'an', wert: 'ELW 1' });
    expect(einheitAusSchluessel('von:Ruf: 4/83-1')).toEqual({ feld: 'von', wert: 'Ruf: 4/83-1' });
  });
});
