import { describe, expect, it } from 'vitest';
import type { Personal, PlanungBlock, PlanungPosten } from '../api/types';
import { OHNE_ABSCHNITT, PAUSE } from '../abloesung/schichtplan/schichtplanZeilen';
import {
  alsSchichtplanBlock,
  blockAendernBody,
  blockBody,
  erzeugenBody,
  GANZE_PLANUNG,
  laengenVorgaben,
  planungPersonen,
  planungSpanne,
  planungTage,
  planungZeilen,
  postenIdAus,
  sollVorgaben,
  zeileVon,
} from './planungZeilen';

const posten = (
  p: Partial<PlanungPosten> & { id: number; bezeichnung: string },
): PlanungPosten => ({
  art: 'einheit',
  sortier: p.id * 10,
  nicht_verfuegbar: false,
  ...p,
});

const block = (b: Partial<PlanungBlock> = {}): PlanungBlock => ({
  id: 1,
  von: '2027-06-12 08:00:00',
  bis: '2027-06-12 12:00:00',
  posten_id: 3,
  befunde: [],
  offene_anforderungen: [],
  offene_plaetze: 0,
  personen: [],
  personen_anzahl: 0,
  version: 1,
  ...b,
});

describe('planungZeilen (LLH-1586)', () => {
  it('Zeilen nach sortier, Abschnitt als Gruppe, Pause zuletzt', () => {
    const zeilen = planungZeilen([
      posten({ id: 2, bezeichnung: 'UHS Bühne', sortier: 20, abschnitt: 'Nord' }),
      posten({ id: 1, bezeichnung: 'RTW 1', sortier: 10, abschnitt: 'Nord' }),
      posten({ id: 3, bezeichnung: 'Fußtrupp', sortier: 30 }),
    ]);
    expect(zeilen.map((z) => [z.titel, z.gruppe])).toEqual([
      ['RTW 1', 'Nord'],
      ['UHS Bühne', 'Nord'],
      ['Fußtrupp', OHNE_ABSCHNITT],
      ['Pause', null],
    ]);
    expect(zeilen[zeilen.length - 1]).toMatchObject({
      schluessel: PAUSE,
      ueberlappungErlaubt: true,
    });
  });

  it('ohne jeden Abschnitt keine Gruppenköpfe', () => {
    const zeilen = planungZeilen([posten({ id: 1, bezeichnung: 'RTW 1' })]);
    expect(zeilen.map((z) => z.gruppe)).toEqual([null, null]);
  });

  it('Zeile und Posten-ID gehen hin und zurück, die Pause ist null', () => {
    expect(postenIdAus(zeileVon(7))).toBe(7);
    expect(postenIdAus(zeileVon(null))).toBeNull();
    expect(postenIdAus('quatsch')).toBeUndefined();
  });

  it('Block der Planung als Block des Einsatzes, mit dem Namen des Postens', () => {
    const b = alsSchichtplanBlock(block({ posten_id: 3 }), new Map([[3, 'RTW 1']]));
    expect(b.posten).toEqual({
      art: 'einheit',
      einheit_id: 3,
      bezeichnung: 'RTW 1',
      aufgeloest: false,
    });
    expect('posten_id' in b).toBe(false);
    expect(alsSchichtplanBlock(block({ posten_id: null }), new Map()).posten.art).toBe('pause');
  });

  it('Bodies hinaus tragen posten_id und nur Stamm-Personal und Helfer', () => {
    expect(
      blockBody({
        posten: { art: 'einheit', einheit_id: 3 },
        von: 'a',
        bis: 'b',
        personen: [
          { art: 'stamm', personal_id: 1 },
          { art: 'einsatz', einsatz_personal_id: 2 },
          { art: 'helfer', helfer_id: 3 },
        ],
      }),
    ).toEqual({
      posten_id: 3,
      von: 'a',
      bis: 'b',
      personen: [
        { art: 'stamm', personal_id: 1 },
        { art: 'helfer', helfer_id: 3 },
      ],
    });
    expect(blockAendernBody({ version: 4, posten: { art: 'pause' } })).toEqual({
      version: 4,
      posten_id: null,
    });
    // Ohne Postenwechsel fehlt posten_id (es hieße sonst „an die Pause“).
    expect(blockAendernBody({ version: 4, von: 'x' })).toEqual({ version: 4, von: 'x' });
    expect(erzeugenBody({ posten: { art: 'einheit', einheit_id: 5 }, von: 'a', bis: 'b' })).toEqual(
      { posten_id: 5, von: 'a', bis: 'b' },
    );
  });

  it('Vorgaben je Zeile: Soll und Schichtlänge des Postens', () => {
    const p = [
      posten({ id: 1, bezeichnung: 'RTW 1', soll_anzahl: 2, schichtlaenge_minuten: 240 }),
      posten({ id: 2, bezeichnung: 'Fußtrupp' }),
    ];
    expect(sollVorgaben(p).get(zeileVon(1))).toBe(2);
    expect(sollVorgaben(p).get(zeileVon(2))).toBeNull();
    expect(laengenVorgaben(p).get(zeileVon(1))).toBe('4 h');
    expect(laengenVorgaben(p).has(zeileVon(2))).toBe(false);
  });

  it('Personen: Stamm und Helfer in ihren Gruppen', () => {
    const optionen = planungPersonen(
      [{ id: 1, name: 'Anna' } as Personal],
      [{ id: 9, name: 'Bea', qualifikationen: [] }],
    );
    expect(optionen.map((o) => [o.name, o.gruppe])).toEqual([
      ['Anna', 'stamm'],
      ['Bea', 'helfer'],
    ]);
  });

  it('Tage der Planung in der Zone, das Ende ausschließlich', () => {
    // 12.06. 08:00 bis 14.06. 00:00 Berliner Zeit: zwei Tage.
    const tage = planungTage(
      { von: '2027-06-12 06:00:00', bis: '2027-06-13 22:00:00' },
      'Europe/Berlin',
    );
    expect(tage.map((t) => t.schluessel)).toEqual(['tag:2027-06-12', 'tag:2027-06-13']);
    expect(tage[0].bis - tage[0].von).toBe(24 * 3_600_000);
  });

  it('Spanne: ein Tag ganz, sonst die Planung auf volle Stunden samt Blöcken außerhalb', () => {
    const kopf = { von: '2027-06-12 06:30:00', bis: '2027-06-12 16:10:00' };
    const tage = planungTage(kopf, 'Europe/Berlin');
    expect(planungSpanne(tage[0].schluessel, kopf, tage, [])).toEqual({
      von: tage[0].von,
      bis: tage[0].bis,
    });
    const ganz = planungSpanne(GANZE_PLANUNG, kopf, tage, []);
    expect(new Date(ganz.von).toISOString()).toBe('2027-06-12T06:00:00.000Z');
    expect(new Date(ganz.bis).toISOString()).toBe('2027-06-12T17:00:00.000Z');
    const spaeter = Date.parse('2027-06-12T19:00:00Z');
    const mitBlock = planungSpanne(GANZE_PLANUNG, kopf, tage, [
      {
        id: 1,
        zeile: 'x',
        von: spaeter - 3_600_000,
        bis: spaeter,
        text: '',
        ampel: 'besetzt',
        ampelWort: '',
      },
    ]);
    expect(mitBlock.bis).toBe(spaeter);
  });
});
