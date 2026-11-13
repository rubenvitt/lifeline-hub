import { describe, expect, it } from 'vitest';
import type { FuehrungAnzeige, FuehrungGegenueber } from '../api/types';
import {
  FUEHRUNG_ART_TEXT,
  fuehrungBeiKurz,
  fuehrungKurz,
  fuehrungMoeglich,
  kopplungBeendetText,
  offeneUebernahmeTitel,
  vorOrtHinweis,
} from './fuehrungText';

const hub: FuehrungGegenueber = {
  kopplung_id: 1,
  kennung: 'k-hub',
  name: 'Hub Nord',
  richtung: 'meldet_sich',
  art: 'standard',
};
const elw: FuehrungGegenueber = {
  kopplung_id: 2,
  kennung: 'k-elw',
  name: 'ELW 1',
  richtung: 'wird_gemeldet',
  art: 'standard',
};

const akte = (teil: Partial<FuehrungAnzeige> = {}): FuehrungAnzeige => ({
  id: 4,
  kennung: 'k-elw/7',
  einsatz_id: 7,
  bezeichnung: 'Hochwasser',
  status: 'aktiv',
  epoche: 1,
  fuehrer_name: 'ELW 1',
  fuehrer_kennung: 'k-elw',
  fuehrend: true,
  art: 'angelegt',
  anfrage_offen: false,
  verwahrt: false,
  gegenueber: [hub],
  verlauf: [],
  ...teil,
});

describe('fuehrungKurz (LLH-1491)', () => {
  it('nennt „hier“ oder die führende Instanz und die Epoche', () => {
    expect(fuehrungKurz({ fuehrend: true, bei: 'ELW 1', epoche: 1 })).toBe(
      'Führung: hier · Epoche 1',
    );
    expect(fuehrungKurz({ fuehrend: false, bei: 'Hub Nord', epoche: 3 })).toBe(
      'Führung: Hub Nord · Epoche 3',
    );
  });

  it('der Kopf nennt nur die fremde führende Instanz', () => {
    expect(fuehrungBeiKurz('Hub Nord')).toBe('Führung: Hub Nord');
  });

  it('kennt jede Art', () => {
    expect(Object.keys(FUEHRUNG_ART_TEXT)).toHaveLength(9);
    expect(FUEHRUNG_ART_TEXT.verwahrung).toBe('Verwahrung');
  });
});

describe('fuehrungMoeglich (LLH-1491)', () => {
  it('führend: übergeben an jedes Gegenüber, per Code nur an die erreichte Seite', () => {
    const m = fuehrungMoeglich(akte({ gegenueber: [hub, elw] }));
    expect(m.uebergeben.map((g) => g.name)).toEqual(['Hub Nord', 'ELW 1']);
    expect(m.perCode.map((g) => g.name)).toEqual(['Hub Nord']);
    expect(m.anfragen || m.notuebernahme || m.notuebernahmeMitBeweis || m.entscheiden).toBe(false);
  });

  it('verwahrt: weder übergeben noch per Code abgeben (LLH-1647)', () => {
    const m = fuehrungMoeglich(akte({ gegenueber: [hub, elw], verwahrt: true, art: 'verwahrung' }));
    expect(m.uebergeben).toEqual([]);
    expect(m.perCode).toEqual([]);
    expect(m.anfragen || m.notuebernahme || m.notuebernahmeMitBeweis || m.entscheiden).toBe(false);
  });

  it('führt die erreichte Seite: anfragen und Notübernahme ohne Beweis', () => {
    const m = fuehrungMoeglich(
      akte({ fuehrend: false, fuehrer_name: 'Hub Nord', fuehrer_richtung: 'meldet_sich' }),
    );
    expect(m.uebergeben).toEqual([]);
    expect(m.anfragen).toBe(true);
    expect(m.notuebernahme).toBe(true);
    expect(m.notuebernahmeMitBeweis).toBe(false);
    expect(
      fuehrungMoeglich(
        akte({ fuehrend: false, fuehrer_richtung: 'meldet_sich', anfrage_offen: true }),
      ).anfragen,
    ).toBe(false);
  });

  it('ohne den Einsatz hier gibt es keine Notübernahme, nur die Anfrage (LLH-1641)', () => {
    const ohne = { fuehrend: false, einsatz_id: undefined };
    const m = fuehrungMoeglich(akte({ ...ohne, fuehrer_richtung: 'meldet_sich' }));
    expect(m.notuebernahme).toBe(false);
    expect(m.anfragen).toBe(true);
    expect(
      fuehrungMoeglich(akte({ ...ohne, fuehrer_richtung: 'wird_gemeldet' })).notuebernahmeMitBeweis,
    ).toBe(false);
  });

  it('führt die meldende Seite: Notübernahme nur mit Unterschrift oder Code', () => {
    const m = fuehrungMoeglich(akte({ fuehrend: false, fuehrer_richtung: 'wird_gemeldet' }));
    expect(m.notuebernahmeMitBeweis).toBe(true);
    expect(m.notuebernahme).toBe(false);
    expect(m.anfragen).toBe(false);
  });

  it('eigene Unterschrift nur für einen Admin, und nur gegen die meldende Seite (LLH-1676)', () => {
    const gegenMeldende = akte({ fuehrend: false, fuehrer_richtung: 'wird_gemeldet' });
    expect(fuehrungMoeglich(gegenMeldende, { darfUnterschreiben: true }).unterschrift).toBe(true);
    expect(fuehrungMoeglich(gegenMeldende, { darfUnterschreiben: false }).unterschrift).toBe(false);
    expect(fuehrungMoeglich(gegenMeldende).unterschrift).toBe(false);
    const gegenErreichte = akte({ fuehrend: false, fuehrer_richtung: 'meldet_sich' });
    expect(fuehrungMoeglich(gegenErreichte, { darfUnterschreiben: true }).unterschrift).toBe(false);
  });

  it('eine offene Übernahme sperrt die Übergabe und verlangt die Entscheidung', () => {
    const m = fuehrungMoeglich(
      akte({
        offen: { von: 'Hub Nord', epoche: 2, bruch_at: '2026-11-09 14:00:00', konflikt: false },
      }),
    );
    expect(m.entscheiden).toBe(true);
    expect(m.uebergeben).toEqual([]);
    expect(m.perCode).toEqual([]);
  });
});

describe('Führung vor Ort (LLH-1497)', () => {
  const vorOrt: FuehrungGegenueber = {
    kopplung_id: 3,
    kennung: 'k-elw2',
    name: 'ELW 2',
    richtung: 'wird_gemeldet',
    art: 'vor_ort',
  };
  const akte = (teil: Partial<FuehrungAnzeige>): FuehrungAnzeige => ({
    id: 1,
    kennung: 'x/1',
    einsatz_id: 5,
    nummer: '1',
    bezeichnung: 'Unwetter',
    stichwort: 'TH',
    status: 'aktiv',
    epoche: 1,
    fuehrer_name: 'ELW 1',
    fuehrer_kennung: 'ich',
    fuehrend: true,
    art: 'angelegt',
    anfrage_offen: false,
    verwahrt: false,
    gegenueber: [hub, vorOrt],
    verlauf: [],
    ...teil,
  });

  it('übergibt nicht an eine Gegenstelle vor Ort und nennt den Grund', () => {
    const m = fuehrungMoeglich(akte({}));
    expect(m.uebergeben.map((g) => g.name)).toEqual(['Hub Nord']);
    expect(m.vorOrt).toEqual(['ELW 2']);
    expect(vorOrtHinweis('ELW 2')).toBe(
      'ELW 2 ist vor Ort gekoppelt: Führungswechsel dorthin kommt später.',
    );
  });

  it('führt die Gegenstelle vor Ort, gibt es weder Anfrage noch Notübernahme', () => {
    const m = fuehrungMoeglich(
      akte({
        fuehrend: false,
        fuehrer_kennung: 'k-elw2',
        fuehrer_name: 'ELW 2',
        fuehrer_richtung: 'wird_gemeldet',
      }),
    );
    expect(m.anfragen).toBe(false);
    expect(m.notuebernahme).toBe(false);
    expect(m.notuebernahmeMitBeweis).toBe(false);
    expect(m.vorOrt).toEqual(['ELW 2']);
  });
});

describe('offeneUebernahmeTitel (LLH-1669)', () => {
  it('nennt ohne Konflikt, wer übernommen hat', () => {
    expect(offeneUebernahmeTitel({ von: 'Hub Nord', konflikt: false }, 'angelegt')).toBe(
      'Führung übernommen von Hub Nord',
    );
  });

  it('sagt im Konflikt, dass die eigene Notübernahme nicht gegriffen hat', () => {
    expect(offeneUebernahmeTitel({ von: 'ELW 1', konflikt: true }, 'notuebernahme')).toBe(
      'Deine Notübernahme hat am Hub nicht gegriffen, die Führung liegt bei ELW 1',
    );
  });

  it('nennt ohne eigene Notübernahme keine', () => {
    expect(offeneUebernahmeTitel({ von: 'ELW 1', konflikt: true }, 'uebergabe')).toBe(
      'Die Führung liegt am Hub bei ELW 1, nicht hier',
    );
  });
});

describe('Zurückholen ohne gekoppelte Führung (LLH-1850)', () => {
  const beendet = akte({
    fuehrend: false,
    fuehrer_name: 'Hub Nord',
    fuehrer_kennung: 'k-hub',
    gegenueber: [],
    fuehrer_beendet_at: '2026-11-10 10:00:00',
  });

  it('bietet das Zurückholen am Spiegel einer beendeten Kopplung, sonst nichts', () => {
    const m = fuehrungMoeglich(beendet);
    expect(m.zurueckholen).toBe(true);
    expect(m.anfragen).toBe(false);
    expect(m.notuebernahme).toBe(false);
    expect(m.notuebernahmeMitBeweis).toBe(false);
    expect(m.uebergeben).toEqual([]);
  });

  it('nicht ohne Widerruf, nicht an der eigenen Führung, nicht ohne den Einsatz hier', () => {
    expect(fuehrungMoeglich({ ...beendet, fuehrer_beendet_at: undefined }).zurueckholen).toBe(
      false,
    );
    expect(fuehrungMoeglich({ ...beendet, fuehrend: true }).zurueckholen).toBe(false);
    expect(fuehrungMoeglich({ ...beendet, einsatz_id: undefined }).zurueckholen).toBe(false);
  });

  it('nennt die beendete Kopplung', () => {
    expect(kopplungBeendetText('Hub Nord')).toBe('Kopplung zu Hub Nord beendet');
  });
});
