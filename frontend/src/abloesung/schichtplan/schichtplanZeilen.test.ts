import { describe, expect, it } from 'vitest';
import type {
  Einheit,
  EinsatzPersonal,
  Personal,
  SchichtplanBlock,
  SchichtplanPerson,
  Uhs,
} from '../../api/types';
import {
  alsRasterBlock,
  ampelVon,
  baueZeilen,
  befundText,
  kopieBody,
  lueckeText,
  mitPerson,
  naechsterBlockBody,
  personenOptionen,
  personenText,
  postenEingabe,
  postenSchluessel,
} from './schichtplanZeilen';

const einheit = (e: Partial<Einheit> & { id: number; name: string }) =>
  ({ abschnitt_id: null, ueber_einheit_id: null, aufgeloest_at: null, ...e }) as Einheit;
const uhs = (u: Partial<Uhs> & { id: number; bezeichnung: string }) =>
  ({ abschnitt_id: null, storniert_at: null, status: 'aktiv', ...u }) as Uhs;

const person = (p: Partial<SchichtplanPerson> & { name: string }): SchichtplanPerson => ({
  art: 'stamm',
  befunde: [],
  im_einsatz: true,
  qualifikationen: [],
  ...p,
});

const block = (b: Partial<SchichtplanBlock> = {}): SchichtplanBlock => ({
  id: 1,
  von: '2026-11-07 10:00:00',
  bis: '2026-11-07 11:00:00',
  posten: { art: 'einheit', einheit_id: 11, bezeichnung: 'RTW 1', aufgeloest: false },
  befunde: [],
  offene_anforderungen: [],
  offene_plaetze: 0,
  personen: [],
  personen_anzahl: 0,
  soll_anzahl: null,
  version: 1,
  ...b,
});

const ABSCHNITTE = [
  { abschnitt_id: 7, abschnitt_name: 'Nord' },
  { abschnitt_id: 8, abschnitt_name: 'Süd' },
];

describe('schichtplanZeilen (LLH-1554)', () => {
  it('Posten und Schlüssel gehen in beide Richtungen', () => {
    for (const s of ['einheit:3', 'uhs:4', 'pause']) {
      expect(postenSchluessel(postenEingabe(s)!)).toBe(s);
    }
    expect(postenEingabe('mittel:1')).toBeNull();
  });

  it('ordnet Zeilen nach Abschnitt der Gliederung, Einheiten vor UHS, Pause zuletzt', () => {
    const zeilen = baueZeilen({
      einheiten: [
        einheit({ id: 1, name: 'RTW Süd', abschnitt_id: 8 }),
        einheit({ id: 2, name: 'RTW Nord', abschnitt_id: 7 }),
        // Untereinheit erbt den Abschnitt der Obereinheit.
        einheit({ id: 3, name: 'Trupp Nord', ueber_einheit_id: 2 }),
        einheit({ id: 4, name: 'Streife' }),
        einheit({ id: 5, name: 'Weg', aufgeloest_at: '2026-11-07 09:00:00' }),
      ],
      uhs: [
        uhs({ id: 9, bezeichnung: 'UHS Nord', abschnitt_id: 7 }),
        uhs({ id: 10, bezeichnung: 'UHS Alt', status: 'aufgeloest' }),
      ],
      abschnitte: ABSCHNITTE,
      bloecke: [],
    });
    expect(zeilen.map((z) => [z.gruppe, z.titel])).toEqual([
      ['Nord', 'RTW Nord'],
      ['Nord', 'Trupp Nord'],
      ['Nord', 'UHS Nord'],
      ['Süd', 'RTW Süd'],
      ['Ohne Abschnitt', 'Streife'],
      [null, 'Pause'],
    ]);
    expect(zeilen[zeilen.length - 1].ueberlappungErlaubt).toBe(true);
  });

  it('ein aufgelöster Posten steht, solange er Blöcke trägt', () => {
    const zeilen = baueZeilen({
      einheiten: [],
      uhs: [],
      abschnitte: ABSCHNITTE,
      bloecke: [
        block({
          posten: { art: 'einheit', einheit_id: 5, bezeichnung: 'RTW 5', aufgeloest: true },
        }),
        block({ id: 2, posten: { art: 'pause', aufgeloest: false } }),
      ],
    });
    expect(zeilen.map((z) => [z.schluessel, z.titel])).toEqual([
      ['einheit:5', 'RTW 5 (aufgelöst)'],
      ['pause', 'Pause'],
    ]);
  });

  describe('Ampel mit Wort', () => {
    it('Befund vor Lücke vor besetzt; ohne Soll nur das Wort', () => {
      expect(
        ampelVon(
          block({
            offene_plaetze: 1,
            personen: [person({ name: 'A', befunde: [{ art: 'doppelt' }] })],
          }),
        ),
      ).toEqual({ ampel: 'befund', wort: 'doppelt verplant' });
      expect(ampelVon(block({ soll_anzahl: 3, offene_plaetze: 2 }))).toEqual({
        ampel: 'luecke',
        wort: '2 offen',
      });
      expect(ampelVon(block({ soll_anzahl: 1, personen_anzahl: 1 }))).toEqual({
        ampel: 'besetzt',
        wort: 'besetzt',
      });
      expect(ampelVon(block())).toEqual({ ampel: 'ohne-soll', wort: 'unbesetzt' });
      expect(ampelVon(block({ personen_anzahl: 1 }))).toEqual({
        ampel: 'ohne-soll',
        wort: 'ohne Soll',
      });
      expect(ampelVon(block({ posten: { art: 'pause', aufgeloest: false } }))).toEqual({
        ampel: 'ohne-soll',
        wort: 'Pause',
      });
      // Wer in der Pause und zugleich am Posten steht, ist auch in der Pause doppelt verplant.
      expect(
        ampelVon(
          block({
            posten: { art: 'pause', aufgeloest: false },
            personen: [person({ name: 'A', befunde: [{ art: 'doppelt' }] })],
          }),
        ),
      ).toEqual({ ampel: 'befund', wort: 'doppelt verplant' });
    });

    it('nennt Lücke und Befunde in Worten', () => {
      const namen = new Map([[3, 'Rettungssanitäter']]);
      expect(
        lueckeText(
          block({
            offene_plaetze: 1,
            offene_anforderungen: [{ qualifikation_id: 3, fehlen: 1 }],
          }),
          namen,
        ),
      ).toBe('1 Platz offen, braucht Rettungssanitäter');
      expect(lueckeText(block({ offene_plaetze: 2 }), namen)).toBe('2 Plätze offen');
      expect(lueckeText(block(), namen)).toBeNull();
      expect(befundText({ art: 'dienst', dauer_minuten: 750 }, namen, 'Anna')).toBe(
        'Anna: 12:30 h im Dienst',
      );
      expect(befundText({ art: 'dienst', dauer_minuten: 45 }, namen)).toBe('45 min im Dienst');
      expect(befundText({ art: 'quali', qualifikation_id: 3, fehlen: 1 }, namen)).toBe(
        '1 × Rettungssanitäter fehlt',
      );
    });

    it('ohne Freigabe Personal stehen nur Zahlen', () => {
      expect(personenText(block({ personen: null, personen_anzahl: 2 }))).toBe('2 Personen');
      expect(personenText(block({ personen: null, personen_anzahl: 0 }))).toBe('unbesetzt');
      expect(
        personenText(block({ personen: [person({ name: 'A' }), person({ name: 'B' })] })),
      ).toBe('A, B');
    });

    it('macht aus einem Serverblock einen Rasterblock in Millisekunden', () => {
      const r = alsRasterBlock(block());
      expect(r.zeile).toBe('einheit:11');
      expect(r.bis - r.von).toBe(60 * 60_000);
      expect(r.von).toBe(Date.UTC(2026, 10, 7, 10, 0));
    });
  });

  describe('Personen', () => {
    const ep = (p: Partial<EinsatzPersonal> & { id: number; name: string }) =>
      ({
        personal_id: null,
        einheit_id: null,
        uhs_id: null,
        beendet_at: null,
        ...p,
      }) as EinsatzPersonal;

    it('gruppiert verfügbar, im Einsatz, Stamm und Helfer; Stamm im Einsatz nur einmal', () => {
      const optionen = personenOptionen(
        [
          ep({ id: 1, name: 'Anna', personal_id: 50 }),
          ep({ id: 2, name: 'Ben', einheit_id: 11 }),
          ep({ id: 3, name: 'Weg', beendet_at: '2026-11-07 09:00:00' }),
        ],
        [{ id: 50, name: 'Anna' } as Personal, { id: 51, name: 'Cem' } as Personal],
        [{ id: 7, name: 'Dana', qualifikationen: [] }],
      );
      expect(optionen.map((o) => [o.schluessel, o.gruppe])).toEqual([
        ['stamm:50', 'verfuegbar'],
        ['einsatz:2', 'im-einsatz'],
        ['stamm:51', 'stamm'],
        ['helfer:7', 'helfer'],
      ]);
    });

    it('eine gezogene Person kommt dazu, eine schon eingeteilte nicht', () => {
      const b = block({ personen: [person({ name: 'Anna', personal_id: 50 })] });
      expect(mitPerson(b, { art: 'stamm', personal_id: 50 })).toBeNull();
      expect(mitPerson(b, { art: 'helfer', helfer_id: 7 })).toEqual([
        { art: 'stamm', personal_id: 50 },
        { art: 'helfer', helfer_id: 7 },
      ]);
    });
  });
});

describe('Kopie eines Blocks (LLH-1584)', () => {
  const voll = block({
    soll_anzahl: 3,
    quali_soll: [{ qualifikation_id: 5, anzahl: 1, label: 'Rettungssanitäter' }],
    notiz: 'Schlüssel an der Wache',
    personen: [person({ name: 'Anna', personal_id: 4 }), person({ name: 'Ben', helfer_id: 9 })],
  });
  const ziel = {
    posten: { art: 'uhs', uhs_id: 2 } as const,
    von: '2026-11-08 10:00:00',
    bis: '2026-11-08 11:00:00',
  };

  it('nimmt Soll, Qualifikationssoll und Personen mit, die Notiz nie', () => {
    expect(kopieBody(voll, ziel, true)).toEqual({
      ...ziel,
      soll_anzahl: 3,
      quali_soll: [{ qualifikation_id: 5, anzahl: 1 }],
      personen: [
        { art: 'stamm', personal_id: 4 },
        { art: 'helfer', helfer_id: 9 },
      ],
    });
    expect(kopieBody(voll, ziel, false).personen).toBeUndefined();
  });

  it('ein Block ohne Soll bleibt ohne, statt die Vorgabe des Ziels zu bekommen', () => {
    const body = kopieBody(block(), ziel, true);
    expect(body).toMatchObject({ soll_anzahl: null, quali_soll: null });
    expect(body.personen).toBeUndefined();
  });

  it('an der Pause kein Soll, aus der Pause die Vorgabe des Zielpostens', () => {
    expect(kopieBody(voll, { ...ziel, posten: { art: 'pause' } }, false)).toEqual({
      posten: { art: 'pause' },
      von: ziel.von,
      bis: ziel.bis,
      soll_anzahl: null,
    });
    const pause = block({ posten: { art: 'pause', aufgeloest: false } });
    const ausPause = kopieBody(pause, ziel, false);
    expect('soll_anzahl' in ausPause).toBe(false);
    expect('quali_soll' in ausPause).toBe(false);
  });

  it('der nächste Block beginnt am Ende, dauert gleich lang und bleibt ohne Personen', () => {
    expect(naechsterBlockBody(voll)).toEqual({
      posten: { art: 'einheit', einheit_id: 11 },
      von: '2026-11-07 11:00:00',
      bis: '2026-11-07 12:00:00',
      soll_anzahl: 3,
      quali_soll: [{ qualifikation_id: 5, anzahl: 1 }],
    });
  });
});
