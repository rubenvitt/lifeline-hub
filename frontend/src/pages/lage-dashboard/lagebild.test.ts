import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Auftrag, LageberichtAnzeige, Meldung } from '../../api/types';
import { auftragszeilen, lageauszug, meldungszeilen } from './lagebild';

/** Feste Zone, damit die Erwartungen nicht von der Maschine abhängen.
 *  `2026-06-11 09:00:00` UTC ist in Berlin (CEST) `11:00`. */
const BERLIN = { zeitzone: 'Europe/Berlin' };

const m = (over: Partial<Meldung>): Meldung =>
  ({
    id: 1, lfd_nr: 1, absender: 'Trupp 1', inhalt: 'Deich instabil',
    ereigniszeit: '2026-06-11 09:00:00', status: 'neu', ist_offen: true,
    ist_ueberfaellig: false, prioritaet: 'normal',
    ...over,
  }) as Meldung;

const a = (over: Partial<Auftrag>): Auftrag =>
  ({
    id: 1, lfd_nr: 1, auftrag_text: 'Deich sichern', frist_at: null,
    bearbeitungsstatus: 'offen', ist_ueberfaellig: false, prioritaet: 'normal',
    ...over,
  }) as Auftrag;

describe('meldungszeilen', () => {
  it('nimmt höchstens drei', () => {
    const viele = [1, 2, 3, 4, 5].map((n) =>
      m({ id: n, lfd_nr: n, ereigniszeit: `2026-06-11 0${n}:00:00` }),
    );
    expect(meldungszeilen(viele)).toHaveLength(3);
  });

  it('nimmt die JÜNGSTEN nach Ereigniszeit', () => {
    const zeilen = meldungszeilen([
      m({ id: 1, lfd_nr: 1, ereigniszeit: '2026-06-11 07:00:00' }),
      m({ id: 2, lfd_nr: 2, ereigniszeit: '2026-06-11 11:00:00' }),
      m({ id: 3, lfd_nr: 3, ereigniszeit: '2026-06-11 09:00:00' }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([2, 3, 1]);
  });

  // Der Zähler darüber zählt OFFENE. Zeigte die Liste erledigte mit, widerspräche
  // sie ihrer eigenen Kopfzahl — genau die Sorte Auseinanderlaufen, gegen die
  // dieses Ticket antritt.
  it('lässt erledigte Meldungen weg', () => {
    const zeilen = meldungszeilen([
      m({ id: 1, lfd_nr: 1, ist_offen: false }),
      m({ id: 2, lfd_nr: 2, ist_offen: true }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([2]);
  });

  it('trägt Zeit, Absender und Text der Meldung', () => {
    const [z] = meldungszeilen(
      [m({ id: 7, lfd_nr: 42, absender: 'ELW 1', inhalt: 'Strom weg' })],
      BERLIN,
    );
    expect(z).toMatchObject({
      id: 7, lfdNr: 42, zeit: '11:00', absender: 'ELW 1', text: 'Strom weg',
    });
  });

  // Die Ereigniszeit ist ein UTC-Wirestring. Vor LFH-336 schnitt `uhrzeit()` die
  // Ziffern per Regex heraus — die Meldung stand dann zwei Stunden in der
  // Vergangenheit, ohne dass irgendwo ein Fehler auftrat.
  it('zeigt die Ereigniszeit in der Anzeigezone, nicht in UTC', () => {
    expect(meldungszeilen([m({ ereigniszeit: '2026-06-11 09:00:00' })], BERLIN)[0].zeit).toBe('11:00');
  });

  it('stuft überfällig als Alarm, neu als Achtung, sonst normal', () => {
    expect(meldungszeilen([m({ ist_ueberfaellig: true })])[0].stufe).toBe('alarm');
    expect(meldungszeilen([m({ status: 'neu' })])[0].stufe).toBe('achtung');
    expect(meldungszeilen([m({ status: 'in_bearbeitung' })])[0].stufe).toBe('normal');
  });
});

describe('auftragszeilen', () => {
  // formatUhrzeitMitTag hängt vom Systemdatum ab (heute → HH:mm, sonst DD. HH:mm) —
  // ungesteuert wäre der Test maschinen-/tagesabhängig.
  afterEach(() => vi.useRealTimers());

  it('sortiert nach Frist, die nächste zuerst', () => {
    const zeilen = auftragszeilen([
      a({ id: 1, lfd_nr: 1, frist_at: '2026-06-11 18:00:00' }),
      a({ id: 2, lfd_nr: 2, frist_at: '2026-06-11 12:00:00' }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([2, 1]);
  });

  // Ein Auftrag OHNE Frist ist nicht dringlicher als einer mit — er ist nur
  // unbestimmt. Sortierte er nach vorn (wie ein leerer String es täte), verdrängte
  // er den überfälligen aus der Dreierliste.
  it('stellt fristlose Aufträge hinter alle mit Frist', () => {
    const zeilen = auftragszeilen([
      a({ id: 1, lfd_nr: 1, frist_at: null }),
      a({ id: 2, lfd_nr: 2, frist_at: '2026-06-11 18:00:00' }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([2, 1]);
  });

  it('lässt vollzogene und abgenommene Aufträge weg', () => {
    const zeilen = auftragszeilen([
      a({ id: 1, lfd_nr: 1, bearbeitungsstatus: 'vollzogen' }),
      a({ id: 2, lfd_nr: 2, bearbeitungsstatus: 'abgenommen' }),
      a({ id: 3, lfd_nr: 3, bearbeitungsstatus: 'in_arbeit' }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([3]);
  });

  it('nimmt höchstens drei', () => {
    const viele = [1, 2, 3, 4].map((n) =>
      a({ id: n, lfd_nr: n, frist_at: `2026-06-11 1${n}:00:00` }),
    );
    expect(auftragszeilen(viele)).toHaveLength(3);
  });

  it('trägt Text und Frist in der Anzeigezone, überfällig als Alarm', () => {
    // Systemzeit 12:00 Berlin am 11.06. — derselbe Tag wie die Frist unten.
    vi.setSystemTime(new Date('2026-06-11T10:00:00Z'));
    const [z] = auftragszeilen(
      [a({ id: 9, lfd_nr: 5, auftrag_text: 'Pumpe setzen', frist_at: '2026-06-11 14:30:00', ist_ueberfaellig: true })],
      BERLIN,
    );
    expect(z).toMatchObject({ id: 9, lfdNr: 5, text: 'Pumpe setzen', frist: '16:30', stufe: 'alarm' });
  });

  // Eine Frist morgen früh sieht in reiner HH:mm optisch aus wie eine in 20 Minuten —
  // genau der Befund, den Fix-Runde 1 zu Task 3 behebt.
  it('stellt bei einer Frist an einem anderen Tag den Tag voran', () => {
    // Systemzeit 08:00 Berlin am 12.06. — ein Tag nach der Frist unten.
    vi.setSystemTime(new Date('2026-06-12T06:00:00Z'));
    const [z] = auftragszeilen(
      [a({ id: 9, lfd_nr: 5, frist_at: '2026-06-11 14:30:00' })],
      BERLIN,
    );
    expect(z.frist).toBe('11. 16:30');
  });

  it('lässt die Frist leer, wenn keine gesetzt ist', () => {
    expect(auftragszeilen([a({ frist_at: null })])[0].frist).toBeNull();
  });
});

describe('lageauszug', () => {
  const bericht = (vorlage: string, abschnitte: { schluessel: string; text: string }[]) =>
    ({ vorlage, abschnitte }) as LageberichtAnzeige;

  it('nimmt bei der Lagebericht-Vorlage die Gefahren-/Schadenlage', () => {
    expect(
      lageauszug(
        bericht('lagebericht', [
          { schluessel: 'auftrag', text: 'Deich halten' },
          { schluessel: 'gefahren_schadenlage', text: 'Pegel steigt' },
        ]),
      ),
    ).toBe('Pegel steigt');
  });

  it('nimmt bei der Lagebeurteilung die Beurteilung der Schadenlage', () => {
    expect(
      lageauszug(
        bericht('lagebeurteilung', [
          { schluessel: 'auftrag', text: 'Deich halten' },
          { schluessel: 'beurteilung_schadenlage', text: 'Lage verschärft sich' },
        ]),
      ),
    ).toBe('Lage verschärft sich');
  });

  it('nimmt beim Freitext den Berichtstext', () => {
    expect(lageauszug(bericht('freitext', [{ schluessel: 'text', text: 'Alles ruhig' }]))).toBe(
      'Alles ruhig',
    );
  });

  // Ein leerer Vorranga­bschnitt darf nicht dazu führen, dass die Kachel schweigt,
  // obwohl der Bericht Inhalt hat.
  it('fällt auf den ersten nicht-leeren Abschnitt zurück', () => {
    expect(
      lageauszug(
        bericht('lagebericht', [
          { schluessel: 'gefahren_schadenlage', text: '   ' },
          { schluessel: 'eigene_lage', text: 'Zwei Züge im Einsatz' },
        ]),
      ),
    ).toBe('Zwei Züge im Einsatz');
  });

  it('liefert null, wenn jeder Abschnitt leer ist', () => {
    expect(lageauszug(bericht('lagebericht', [{ schluessel: 'eigene_lage', text: '' }]))).toBeNull();
  });

  it('liefert null ohne Bericht', () => {
    expect(lageauszug(null)).toBeNull();
  });

  it('kürzt lange Abschnitte auf 240 Zeichen mit Auslassungszeichen', () => {
    const lang = 'x'.repeat(400);
    const auszug = lageauszug(bericht('freitext', [{ schluessel: 'text', text: lang }]));
    expect(auszug).toHaveLength(241);
    expect(auszug?.endsWith('…')).toBe(true);
  });
});
