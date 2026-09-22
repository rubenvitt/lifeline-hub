import { describe, expect, it } from 'vitest';
import type { PegelAnzeige } from '../api/types';
import { formatUhrzeit } from '../anzeige/format';
import {
  messEpoche,
  pegelKennzahl,
  pegelNotizKurz,
  prognoseOffen,
  prognoseText,
  standZeit,
  trendRichtung,
  trendText,
  wasserstandMeter,
} from './pegelKennzahl';

/** Feste Zone, damit die Erwartungen nicht von der Maschine abhängen. */
const BERLIN = { zeitzone: 'Europe/Berlin' };

/** 2026-09-22 12:30:00 UTC = 14:30 Sommerzeit Berlin — der „Jetzt"-Punkt. */
const JETZT = Date.UTC(2026, 8, 22, 12, 30, 0);

const pegel = (over: Partial<PegelAnzeige> = {}): PegelAnzeige => ({
  id: 1,
  station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
  name: 'HANN. MÜNDEN',
  gewaesser: 'WESER',
  reihenfolge: 0,
  messung: {
    wasserstand_cm: 684,
    // 14:05 Berliner Ortszeit, mit Versatz — wie PEGELONLINE ihn liefert.
    zeitpunkt: '2026-09-22T14:05:00+02:00',
    trend_cm_pro_h: 9.2,
  },
  ...over,
});

describe('Zeit mit Versatz (die Falle der Wirestring-Formatierer)', () => {
  it('formatUhrzeit liest den Versatz und rechnet in die Anzeigezone', () => {
    expect(formatUhrzeit('2026-09-22T14:05:00+02:00', BERLIN)).toBe('14:05');
    // Derselbe Zeitpunkt in UTC geschrieben ergibt dieselbe Ortszeit.
    expect(formatUhrzeit('2026-09-22T12:05:00Z', BERLIN)).toBe('14:05');
    // Anders gezont: New York liegt sechs Stunden hinter Berlin.
    expect(formatUhrzeit('2026-09-22T14:05:00+02:00', { zeitzone: 'America/New_York' })).toBe(
      '08:05',
    );
  });

  it('hält beide Sommerzeit-Grenzen: der Versatz der Quelle wechselt mit', () => {
    // Letzte Messung vor dem Rückstellen (25.10.2026, 03:00 MESZ → 02:00 MEZ) …
    expect(formatUhrzeit('2026-10-25T02:45:00+02:00', BERLIN)).toBe('02:45');
    // … und eine danach, jetzt mit +01:00 (01:15 UTC = 02:15 MEZ).
    expect(formatUhrzeit('2026-10-25T02:15:00+01:00', BERLIN)).toBe('02:15');
    // Vorstellen (29.03.2026, 02:00 MEZ → 03:00 MESZ).
    expect(formatUhrzeit('2026-03-29T01:45:00+01:00', BERLIN)).toBe('01:45');
    expect(formatUhrzeit('2026-03-29T03:15:00+02:00', BERLIN)).toBe('03:15');
  });

  it('das Alter kommt aus Date.parse und ist absolut, nicht ortszeitlich', () => {
    expect(messEpoche('2026-09-22T14:05:00+02:00')).toBe(Date.UTC(2026, 8, 22, 12, 5, 0));
    expect(messEpoche('kaputt')).toBeNaN();
  });
});

describe('standZeit', () => {
  it('am selben Tag wie „jetzt“ nur die Uhrzeit, gegen jetzt statt gegen die Maschinenuhr', () => {
    expect(standZeit('2026-09-22T14:05:00+02:00', JETZT, BERLIN)).toBe('14:05');
  });

  it('ein Stand vom Vortag trägt das Tag-Präfix', () => {
    expect(standZeit('2026-09-21T23:50:00+02:00', JETZT, BERLIN)).toBe('21. 23:50');
  });

  it('die Tagesgrenze liegt in der Anzeigezone, nicht in UTC', () => {
    // 22.09. 00:10 Berlin ist 21.09. 22:10 UTC — in Berlin derselbe Tag wie JETZT.
    expect(standZeit('2026-09-21T22:10:00Z', JETZT, BERLIN)).toBe('00:10');
    // In New York ist JETZT (12:30 UTC) der 22., der Stand (18:10 am 21.) der Vortag.
    expect(standZeit('2026-09-21T22:10:00Z', JETZT, { zeitzone: 'America/New_York' })).toBe(
      '21. 18:10',
    );
  });
});

describe('wasserstandMeter', () => {
  it('rechnet cm in m mit zwei Nachkommastellen und deutschem Komma', () => {
    expect(wasserstandMeter(684)).toBe('6,84');
    expect(wasserstandMeter(63)).toBe('0,63');
    expect(wasserstandMeter(1250)).toBe('12,50');
    // Keine Tausendergruppierung — ein Pegel über 10 m ist keine „1.000".
    expect(wasserstandMeter(123456)).toBe('1234,56');
  });

  it('trägt bei negativem Stand das echte Minuszeichen und kennt kein „-0,00"', () => {
    expect(wasserstandMeter(-12)).toBe('−0,12');
    expect(wasserstandMeter(-0.2)).toBe('0,00');
  });
});

describe('Trend', () => {
  it('Richtung: |t| < 1 ist gleichbleibend, sonst nach Vorzeichen; ohne Trend null', () => {
    expect(trendRichtung(9.2)).toBe('steigend');
    expect(trendRichtung(-3)).toBe('fallend');
    expect(trendRichtung(0.9)).toBe('gleichbleibend');
    expect(trendRichtung(-0.99)).toBe('gleichbleibend');
    expect(trendRichtung(1)).toBe('steigend');
    expect(trendRichtung(null)).toBeNull();
    expect(trendRichtung(undefined)).toBeNull();
  });

  it('Text: Wort plus ganze cm/h, fallend mit echtem Minus', () => {
    expect(trendText(9.2)).toBe('steigend +9 cm/h');
    expect(trendText(-3.4)).toBe('fallend −3 cm/h');
    expect(trendText(-2.6)).toBe('fallend −3 cm/h');
    expect(trendText(0.4)).toBe('gleichbleibend');
    expect(trendText(null)).toBe('Trend unbekannt');
    // Kein Bindestrich als Minus.
    expect(trendText(-5)).not.toContain('-');
  });
});

/**
 * Die Tabelle IST die Festlegung: jeder Fall mit Wert, Einheit, Notiz und Ton.
 * `formatUhrzeitMitTag` setzt den Tag voran, wenn der Messtag nicht „heute" auf der echten
 * Uhr ist — deshalb die Erwartung mit optionalem Tag.
 */
describe('pegelKennzahl', () => {
  it('Messung frisch: Meter, Einheit, Gewässer · Trend · Stand, neutral', () => {
    const k = pegelKennzahl([pegel()], JETZT, BERLIN);
    expect(k).toMatchObject({ fall: 'messung', wert: '6,84', einheit: 'm', ton: 'neutral' });
    expect(k.veraltet).toBe(false);
    expect(k.notiz).toBe('WESER · steigend +9 cm/h · Stand 14:05');
  });

  it('ohne Gewässer steht der Stationsname', () => {
    const k = pegelKennzahl([pegel({ gewaesser: null })], JETZT, BERLIN);
    expect(k.notiz).toMatch(/^HANN\. MÜNDEN · /);
    const leer = pegelKennzahl([pegel({ gewaesser: '  ' })], JETZT, BERLIN);
    expect(leer.notiz).toMatch(/^HANN\. MÜNDEN · /);
  });

  it('ohne Trend: „Trend unbekannt"', () => {
    const k = pegelKennzahl(
      [pegel({ messung: { wasserstand_cm: 684, zeitpunkt: '2026-09-22T14:05:00+02:00' } })],
      JETZT,
      BERLIN,
    );
    expect(k.notiz).toContain('Trend unbekannt');
  });

  it('genau 60 min ist noch frisch, darüber „veraltet" mit Ton achtung', () => {
    const grenze = messEpoche('2026-09-22T14:05:00+02:00') + 60 * 60_000;
    expect(pegelKennzahl([pegel()], grenze, BERLIN)).toMatchObject({
      ton: 'neutral',
      veraltet: false,
    });
    const k = pegelKennzahl([pegel()], grenze + 1000, BERLIN);
    expect(k).toMatchObject({ fall: 'messung', wert: '6,84', ton: 'achtung', veraltet: true });
    expect(k.notiz).toBe('WESER · steigend +9 cm/h · Stand 14:05 · veraltet');
  });

  it('ein Stand vom Vortag nennt den Tag in der Notiz', () => {
    const k = pegelKennzahl(
      [pegel({ messung: { ...pegel().messung!, zeitpunkt: '2026-09-21T23:50:00+02:00' } })],
      JETZT,
      BERLIN,
    );
    expect(k.notiz).toBe('WESER · steigend +9 cm/h · Stand 21. 23:50 · veraltet');
  });

  it('Ausfall: festgelegt, keine Messung → „—", „Stand unbekannt", achtung', () => {
    const k = pegelKennzahl([pegel({ messung: null })], JETZT, BERLIN);
    expect(k).toEqual({
      fall: 'ausfall',
      wert: '—',
      notiz: 'WESER · Stand unbekannt',
      ton: 'achtung',
      veraltet: false,
    });
    expect(k.einheit).toBeUndefined();
  });

  it('ein unlesbarer Zeitpunkt ist ein Ausfall, kein erfundener Stand', () => {
    const k = pegelKennzahl(
      [pegel({ messung: { wasserstand_cm: 684, zeitpunkt: 'kaputt' } })],
      JETZT,
      BERLIN,
    );
    expect(k.fall).toBe('ausfall');
    expect(k.notiz).not.toContain('Invalid');
  });

  it('keiner festgelegt: „—", „kein Pegel festgelegt", neutral', () => {
    expect(pegelKennzahl([], JETZT, BERLIN)).toEqual({
      fall: 'keiner',
      wert: '—',
      notiz: 'kein Pegel festgelegt',
      ton: 'neutral',
      veraltet: false,
    });
  });

  it('mehrere: der erste ist Leitpegel, die übrigen als „+n weitere"', () => {
    const k = pegelKennzahl(
      [
        pegel(),
        pegel({ id: 2, reihenfolge: 1, gewaesser: 'FULDA', messung: null }),
        pegel({ id: 3, reihenfolge: 2, gewaesser: 'WERRA' }),
      ],
      JETZT,
      BERLIN,
    );
    expect(k.wert).toBe('6,84');
    expect(k.notiz).toMatch(/^WESER · .* · \+2 weitere$/);
    const ausfall = pegelKennzahl([pegel({ messung: null }), pegel({ id: 2 })], JETZT, BERLIN);
    expect(ausfall.notiz).toBe('WESER · Stand unbekannt · +1 weitere');
  });
});

describe('pegelNotizKurz (Überblick)', () => {
  it('„Pegel 6,84 m steigend" aus derselben Rechnung', () => {
    expect(pegelNotizKurz([pegel()], JETZT)).toBe('Pegel 6,84 m steigend');
    expect(
      pegelNotizKurz([pegel({ messung: { ...pegel().messung!, trend_cm_pro_h: -4 } })], JETZT),
    ).toBe('Pegel 6,84 m fallend');
    expect(
      pegelNotizKurz([pegel({ messung: { ...pegel().messung!, trend_cm_pro_h: null } })], JETZT),
    ).toBe('Pegel 6,84 m');
  });

  it('ohne Pegel keine Notiz, bei Ausfall „Pegel: Stand unbekannt", veraltet mit Wort', () => {
    expect(pegelNotizKurz([], JETZT)).toBeNull();
    expect(pegelNotizKurz([pegel({ messung: null })], JETZT)).toBe('Pegel: Stand unbekannt');
    expect(pegelNotizKurz([pegel()], JETZT + 2 * 3_600_000)).toBe(
      'Pegel 6,84 m steigend · veraltet',
    );
  });
});

describe('Prognose am Leitpegel (LFH-628)', () => {
  /** 18:00 Berlin = 16:00 UTC, im Wire-Format ohne Zone. */
  const prognose = (zeitpunkt = '2026-09-22 16:00:00') => ({
    hoechststand_cm: 710,
    zeitpunkt,
    gesetzt_at: '2026-09-22 10:00:00',
  });

  it('offen: eigener Teil hinter dem Datenstand, vor „+n weitere"', () => {
    const k = pegelKennzahl(
      [pegel({ prognose: prognose() }), pegel({ id: 2, reihenfolge: 1 })],
      JETZT,
      BERLIN,
    );
    expect(k.notiz).toBe(
      'WESER · steigend +9 cm/h · Stand 14:05 · Prognose 7,10 m bis 18:00 · +1 weitere',
    );
  });

  it('ohne Prognose und mit abgelaufener ist die Notiz byte-gleich zur Fassung ohne', () => {
    const ohne = pegelKennzahl([pegel()], JETZT, BERLIN);
    expect(ohne.notiz).toBe('WESER · steigend +9 cm/h · Stand 14:05');
    // 12:00 UTC liegt vor JETZT (12:30 UTC): vorbei.
    expect(
      pegelKennzahl([pegel({ prognose: prognose('2026-09-22 12:00:00') })], JETZT, BERLIN),
    ).toEqual(ohne);
    // Genau jetzt zählt als verstrichen.
    expect(
      pegelKennzahl([pegel({ prognose: prognose('2026-09-22 12:30:00') })], JETZT, BERLIN),
    ).toEqual(ohne);
  });

  it('auch bei Ausfall der Messung steht die Prognose', () => {
    const k = pegelKennzahl([pegel({ messung: undefined, prognose: prognose() })], JETZT, BERLIN);
    expect(k.fall).toBe('ausfall');
    expect(k.notiz).toBe('WESER · Stand unbekannt · Prognose 7,10 m bis 18:00');
  });

  it('nur der Leitpegel zählt — die Prognose eines weiteren Pegels steht nicht in der Kennzahl', () => {
    const k = pegelKennzahl(
      [pegel(), pegel({ id: 2, reihenfolge: 1, prognose: prognose() })],
      JETZT,
      BERLIN,
    );
    expect(k.notiz).not.toContain('Prognose');
  });

  it('am anderen Tag mit Tag davor; unlesbarer Zeitpunkt gilt als abgelaufen', () => {
    expect(prognoseText(prognose('2026-09-23 04:00:00'), JETZT, BERLIN)).toBe(
      'Prognose 7,10 m bis 23. 06:00',
    );
    expect(prognoseOffen(prognose('kaputt'), JETZT)).toBe(false);
    expect(prognoseOffen(prognose(), JETZT)).toBe(true);
  });
});
