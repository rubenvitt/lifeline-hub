import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import type { Sonderkost, VerpflegungZeitfenster } from '../api/types';
import { deckungEinstufung, istVergangen } from './deckung';

/**
 * Einstufung eines Verpflegungszeitfensters (LFH-634, design.md D2). Geprüft wird gegen
 * ABSOLUTE Zeitpunkte (`…Z`), nie per Round-Trip: ein Ortszeit-Lesen der Wire-Zeit verschöbe
 * beide Seiten eines Round-Trips um denselben Betrag und bliebe grün.
 */

/** Absoluter Zeitpunkt, unabhängig von der Zone der Testmaschine. */
const abs = (iso: string) => dayjs(iso);

const KEINE: Sonderkost = {
  vegetarisch: 0,
  vegan: 0,
  ohne_schwein: 0,
  diaet_allergenarm: 0,
  saeugling_kleinkind: 0,
};

/** „Mittag“: Wire-Zeiten UTC ohne Zonenkennung, 10:00–11:30 UTC (12:00–13:30 in Berlin). */
function zeitfenster(
  fehlmengeGesamt: number,
  fehlmengeSonderkost: Partial<Sonderkost> = {},
): VerpflegungZeitfenster {
  return {
    id: 1,
    einsatz_id: 7,
    bezeichnung: 'Mittag',
    von_at: '2026-09-24 10:00:00',
    bis_at: '2026-09-24 11:30:00',
    bedarf: {
      kraefte: 180,
      betreute: 70,
      weitere: 0,
      gesamt: 250,
      sonderkost: { ...KEINE, vegan: 3 },
    },
    ausgegeben: { gesamt: 250 - fehlmengeGesamt, sonderkost: KEINE },
    fehlmenge: { gesamt: fehlmengeGesamt, sonderkost: { ...KEINE, ...fehlmengeSonderkost } },
    ausgaben: [],
    angelegt_at: '2026-09-24 08:00:00',
  };
}

describe('deckungEinstufung — Grenze am Beginn', () => {
  it('genau jetzt == von hat begonnen: Fehlmenge ist Unterdeckung', () => {
    expect(deckungEinstufung(zeitfenster(20), abs('2026-09-24T10:00:00Z'))).toBe('unterdeckung');
  });

  it('eine Sekunde vor Beginn ist dieselbe Fehlmenge noch offen', () => {
    expect(deckungEinstufung(zeitfenster(20), abs('2026-09-24T09:59:59Z'))).toBe('offen');
  });

  it('liest die Wire-Zeit als UTC: 11:59 in Berlin (UTC+2) ist VOR dem Beginn um 10:00 UTC', () => {
    // Ein `dayjs(s)` läse `10:00:00` als Berliner Ortszeit (= 08:00 UTC) und stufte 09:59 UTC
    // schon als begonnen ein.
    expect(deckungEinstufung(zeitfenster(20), abs('2026-09-24T11:59:00+02:00'))).toBe('offen');
    expect(deckungEinstufung(zeitfenster(20), abs('2026-09-24T12:00:00+02:00'))).toBe(
      'unterdeckung',
    );
  });

  it('eine Fehlmenge vor Beginn ist offen, auch die volle', () => {
    expect(deckungEinstufung(zeitfenster(250), abs('2026-09-24T08:00:00Z'))).toBe('offen');
  });
});

describe('deckungEinstufung — gedeckt heißt: keine Fehlmenge, weder gesamt noch je Kostform', () => {
  it('ohne Fehlmenge ist gedeckt, vor und nach Beginn', () => {
    expect(deckungEinstufung(zeitfenster(0), abs('2026-09-24T08:00:00Z'))).toBe('gedeckt');
    expect(deckungEinstufung(zeitfenster(0), abs('2026-09-24T10:30:00Z'))).toBe('gedeckt');
  });

  it('Überdeckung (Server liefert Fehlmenge 0, nie negativ) ist gedeckt', () => {
    const zf = zeitfenster(0);
    zf.ausgegeben = { gesamt: 300, sonderkost: { ...KEINE, vegan: 5 } };
    expect(deckungEinstufung(zf, abs('2026-09-24T10:30:00Z'))).toBe('gedeckt');
  });

  it('Fehlmenge nur in einer Kostform ist nach Beginn Unterdeckung, trotz Gesamtdeckung', () => {
    expect(deckungEinstufung(zeitfenster(0, { vegan: 3 }), abs('2026-09-24T10:30:00Z'))).toBe(
      'unterdeckung',
    );
  });

  it('jede der fünf Kostformen zählt einzeln', () => {
    for (const k of Object.keys(KEINE) as (keyof Sonderkost)[]) {
      expect(deckungEinstufung(zeitfenster(0, { [k]: 1 }), abs('2026-09-24T10:30:00Z')), k).toBe(
        'unterdeckung',
      );
      expect(deckungEinstufung(zeitfenster(0, { [k]: 1 }), abs('2026-09-24T09:00:00Z')), k).toBe(
        'offen',
      );
    }
  });
});

describe('istVergangen — Trennung der Segmentleiste', () => {
  it('vergangen erst, wenn das Ende VOR jetzt liegt; genau am Ende läuft es noch', () => {
    expect(istVergangen(zeitfenster(0), abs('2026-09-24T11:30:00Z'))).toBe(false);
    expect(istVergangen(zeitfenster(0), abs('2026-09-24T11:30:01Z'))).toBe(true);
    expect(istVergangen(zeitfenster(0), abs('2026-09-24T10:00:00Z'))).toBe(false);
  });

  it('liest das Ende als UTC: 13:29 in Berlin ist vor 11:30 UTC', () => {
    expect(istVergangen(zeitfenster(0), abs('2026-09-24T13:29:00+02:00'))).toBe(false);
    expect(istVergangen(zeitfenster(0), abs('2026-09-24T13:31:00+02:00'))).toBe(true);
  });
});
