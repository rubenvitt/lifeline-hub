import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import {
  DEICH,
  FELDKUECHE,
  KEINE_SONDERKOST,
  TURNHALLE,
  stelle,
  verpflegungMitStellen,
  zeitfenster,
} from '../test/verpflegungDaten';
import {
  laufendeZeitfensterDerStelle,
  offeneStellenCount,
  stellenWahl,
  zeilenJeStelle,
} from './stellenKern';

dayjs.extend(utc);

/** 12:30 Berlin = 10:30 UTC: „Mittag“ (10:00–11:30 UTC) läuft, „Abend“ steht an. */
const MITTAGS = dayjs.utc('2026-09-24 10:30:00');
const ist = (gesamt: number) => ({ gesamt, sonderkost: KEINE_SONDERKOST });

describe('laufendeZeitfensterDerStelle (LLH-1040 D13 Punkt 2)', () => {
  const v = verpflegungMitStellen();

  it('nennt das laufende Zeitfenster der Feldküche mit ihrem Ist aus je_stelle (200/100/80)', () => {
    expect(laufendeZeitfensterDerStelle(FELDKUECHE, v.zeitfenster, MITTAGS)).toEqual([
      { zeitfenster: v.zeitfenster[0], ausgegeben: 100 },
    ]);
    expect(laufendeZeitfensterDerStelle(TURNHALLE, v.zeitfenster, MITTAGS)).toEqual([
      { zeitfenster: v.zeitfenster[0], ausgegeben: 80 },
    ]);
  });

  it('ist leer für eine Stelle ohne laufendes Zeitfenster', () => {
    expect(laufendeZeitfensterDerStelle(DEICH, v.zeitfenster, MITTAGS)).toEqual([]);
    // Nach dem Ende von „Mittag“ läuft an der Feldküche nichts mehr.
    const abends = dayjs.utc('2026-09-24 12:00:00');
    expect(laufendeZeitfensterDerStelle(FELDKUECHE, v.zeitfenster, abends)).toEqual([]);
  });

  it('zählt vor dem Beginn nicht als laufend', () => {
    const vorher = dayjs.utc('2026-09-24 09:59:00');
    expect(laufendeZeitfensterDerStelle(FELDKUECHE, v.zeitfenster, vorher)).toEqual([]);
  });

  it('führt überlappende Fenster nach Beginn, ein zugeordnetes ohne Ausgabe mit 0', () => {
    const frueh = zeitfenster({
      id: 7,
      bezeichnung: 'Getränke',
      von_at: '2026-09-24 09:00:00',
      bis_at: '2026-09-24 14:00:00',
      stelle_ids: [FELDKUECHE],
      je_stelle: [{ stelle_id: FELDKUECHE, ausgegeben: ist(0) }],
    });
    const liste = [...v.zeitfenster, frueh];
    expect(
      laufendeZeitfensterDerStelle(FELDKUECHE, liste, MITTAGS).map((x) => [
        x.zeitfenster.bezeichnung,
        x.ausgegeben,
      ]),
    ).toEqual([
      ['Getränke', 0],
      ['Mittag', 100],
    ]);
  });

  it('nimmt ein Fenster mit Ausgabe an einer nicht zugeordneten Stelle mit', () => {
    const zf = zeitfenster({
      stelle_ids: [FELDKUECHE],
      je_stelle: [
        { stelle_id: FELDKUECHE, ausgegeben: ist(100) },
        { stelle_id: DEICH, ausgegeben: ist(30) },
      ],
    });
    expect(laufendeZeitfensterDerStelle(DEICH, [zf], MITTAGS)).toEqual([
      { zeitfenster: zf, ausgegeben: 30 },
    ]);
  });
});

describe('zeilenJeStelle (Karte, D13 Punkt 4)', () => {
  it('folgt der Reihenfolge des Servers und nennt die Menge je Stelle (200/100/80)', () => {
    const v = verpflegungMitStellen();
    expect(zeilenJeStelle(v.zeitfenster[0], v.stellen)).toEqual([
      {
        stelleId: TURNHALLE,
        bezeichnung: 'Ausgabe Turnhalle Nord',
        ausgegeben: 80,
        kennzeichen: [],
      },
      {
        stelleId: FELDKUECHE,
        bezeichnung: 'Feldküche BR Sportplatz',
        ausgegeben: 100,
        kennzeichen: [],
      },
    ]);
  });

  it('ist leer bei leerer Aufstellung (Bestand ohne Stelle)', () => {
    const v = verpflegungMitStellen();
    expect(zeilenJeStelle(v.zeitfenster[1], v.stellen)).toEqual([]);
  });

  it('kennzeichnet aufgelöste und nicht zugeordnete Stellen, „ohne Stelle“ steht zuletzt', () => {
    const stellen = [
      stelle({ id: FELDKUECHE, bezeichnung: 'Feldküche', status: 'aufgeloest' }),
      stelle({ id: DEICH, bezeichnung: 'Zuführung Deich', art: 'zufuehrung' }),
    ];
    const zf = zeitfenster({
      stelle_ids: [FELDKUECHE],
      je_stelle: [
        { stelle_id: null, ausgegeben: ist(30) },
        { stelle_id: FELDKUECHE, ausgegeben: ist(100) },
        { stelle_id: DEICH, ausgegeben: ist(20) },
      ],
    });
    expect(zeilenJeStelle(zf, stellen)).toEqual([
      {
        stelleId: FELDKUECHE,
        bezeichnung: 'Feldküche',
        ausgegeben: 100,
        kennzeichen: ['aufgelöst'],
      },
      {
        stelleId: DEICH,
        bezeichnung: 'Zuführung Deich',
        ausgegeben: 20,
        kennzeichen: ['nicht zugeordnet'],
      },
      { stelleId: null, bezeichnung: 'ohne Stelle', ausgegeben: 30, kennzeichen: [] },
    ]);
  });

  it('nennt eine unbekannte Stelle mit ihrer Kennung statt sie wegzulassen', () => {
    const zf = zeitfenster({ je_stelle: [{ stelle_id: 99, ausgegeben: ist(5) }] });
    expect(zeilenJeStelle(zf, [])[0]).toMatchObject({ bezeichnung: 'Stelle #99', ausgegeben: 5 });
  });
});

describe('stellenWahl (Nachtrag, Ausgabeansicht, Zeitfensterdialog)', () => {
  const stellen = [
    stelle({ id: 1, bezeichnung: 'A aufgelöst', status: 'aufgeloest' }),
    stelle({ id: 2, bezeichnung: 'B frei', status: 'geplant' }),
    stelle({ id: 3, bezeichnung: 'C zugeordnet' }),
    stelle({ id: 4, bezeichnung: 'D zugeordnet, aufgelöst', status: 'aufgeloest' }),
  ];
  const zf = zeitfenster({ stelle_ids: [3, 4] });

  it('stellt die zugeordneten zuerst und trennt die aufgelösten ab', () => {
    const wahl = stellenWahl(stellen, zf);
    expect(wahl.zugeordnet.map((s) => s.id)).toEqual([3]);
    expect(wahl.weitere.map((s) => s.id)).toEqual([2]);
    expect(wahl.aufgeloest.map((s) => s.id)).toEqual([4, 1]);
  });

  it('ohne Zeitfenster sind alle offenen „weitere“', () => {
    const wahl = stellenWahl(stellen, null);
    expect(wahl.zugeordnet).toEqual([]);
    expect(wahl.weitere.map((s) => s.id)).toEqual([2, 3]);
  });

  it('ist leer ohne Stellen', () => {
    expect(stellenWahl([], zf)).toEqual({ zugeordnet: [], weitere: [], aufgeloest: [] });
  });
});

describe('offeneStellenCount (Zählung der Segmentleiste)', () => {
  it('zählt nicht aufgelöste Stellen', () => {
    expect(offeneStellenCount(verpflegungMitStellen().stellen)).toBe(3);
    expect(offeneStellenCount([stelle({ id: 1, status: 'aufgeloest' }), stelle({ id: 2 })])).toBe(
      1,
    );
  });
});
