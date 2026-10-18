import { describe, expect, it } from 'vitest';
import type { UhsBelegung } from '../../api/types';
import {
  DRINGLICHKEITS_REIHE,
  dringlichkeitsRang,
  dringlichkeitsWert,
  gehalteneFolge,
  nachDringlichkeit,
  compareDringlichkeit,
  transportRang,
  type DringlichkeitsMerkmale,
  wartetSeit,
  wartezeitMinuten,
  wartezeitText,
} from './dringlichkeit';

function belegung(over: Partial<UhsBelegung>): UhsBelegung {
  return {
    id: 1,
    einsatz_id: 1,
    uhs_id: 1,
    person_id: 7,
    platz_id: null,
    art: 'eintritt',
    notiz: null,
    erfasst_von: 1,
    zeitpunkt_at: '2026-10-18 08:00:00',
    ...over,
  };
}

describe('Dringlichkeitsreihe (LLH-1135)', () => {
  it('ungesichtet zuerst, dann SK I bis SK IV, tot, unverletzt', () => {
    expect(DRINGLICHKEITS_REIHE).toEqual([
      'ungesichtet',
      'sk1',
      'sk2',
      'sk3',
      'sk4',
      'tot',
      'unverletzt',
    ]);
    expect(dringlichkeitsRang(null)).toBe(0);
    expect(dringlichkeitsRang(undefined)).toBe(0);
    expect(dringlichkeitsRang('sk1')).toBe(1);
    expect(dringlichkeitsRang('unverletzt')).toBe(6);
  });

  it('sortiert nach Kategorie, innerhalb der Kategorie die längste Wartezeit zuerst', () => {
    const personen = [
      { id: 'sk3-alt', sichtung: 'sk3', seit: '2026-10-18 07:00:00' },
      { id: 'unverletzt', sichtung: 'unverletzt', seit: '2026-10-18 06:00:00' },
      { id: 'sk1-jung', sichtung: 'sk1', seit: '2026-10-18 08:30:00' },
      { id: 'ungesichtet', sichtung: null, seit: '2026-10-18 08:45:00' },
      { id: 'sk1-alt', sichtung: 'sk1', seit: '2026-10-18 08:10:00' },
      { id: 'tot', sichtung: 'tot', seit: '2026-10-18 05:00:00' },
      { id: 'sk2', sichtung: 'sk2', seit: '2026-10-18 08:00:00' },
      { id: 'sk4', sichtung: 'sk4', seit: '2026-10-18 08:00:00' },
    ] as const;
    expect(nachDringlichkeit(personen, ohnePrioritaet).map((p) => p.id)).toEqual([
      'ungesichtet',
      'sk1-alt',
      'sk1-jung',
      'sk2',
      'sk3-alt',
      'sk4',
      'tot',
      'unverletzt',
    ]);
  });

  it('ohne Beginn steht eine Person hinten in ihrer Kategorie, gleiche bleiben in ihrer Folge', () => {
    const personen = [
      { id: 'a', sichtung: 'sk2' as const, seit: null },
      { id: 'b', sichtung: 'sk2' as const, seit: '2026-10-18 09:00:00' },
      { id: 'c', sichtung: 'sk2' as const, seit: null },
    ];
    expect(nachDringlichkeit(personen, ohnePrioritaet).map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(compareDringlichkeit(ohnePrioritaet(personen[0]), ohnePrioritaet(personen[2]))).toBe(0);
  });

  it('lässt die Eingabe unverändert', () => {
    const personen = [
      { sichtung: 'sk3' as const, seit: null },
      { sichtung: 'sk1' as const, seit: null },
    ];
    nachDringlichkeit(personen, ohnePrioritaet);
    expect(personen.map((p) => p.sichtung)).toEqual(['sk3', 'sk1']);
  });

  it('der Sortierwert der Datensicht ordnet aufsteigend wie der Vergleich', () => {
    const reihe = [
      { sichtung: null, seit: '2026-10-18 09:00:00' },
      { sichtung: 'sk1' as const, seit: '2026-10-18 08:00:00' },
      { sichtung: 'sk1' as const, seit: '2026-10-18 08:30:00' },
      { sichtung: 'sk1' as const, seit: null },
      { sichtung: 'sk3' as const, seit: '2020-01-01 00:00:00' },
      { sichtung: 'unverletzt' as const, seit: null },
    ];
    const werte = reihe.map((m) => dringlichkeitsWert(ohnePrioritaet(m)));
    expect([...werte].sort((a, b) => a - b)).toEqual(werte);
    expect(new Set(werte).size).toBe(werte.length);
  });
});

/** Die Merkmale eines Eintrags ohne Transportpriorität. */
function ohnePrioritaet<T extends Omit<DringlichkeitsMerkmale, 'prioritaet'>>(
  m: T,
): T & DringlichkeitsMerkmale {
  return { ...m, prioritaet: null };
}

describe('Transportpriorität innerhalb der Sichtungskategorie (LLH-1325, design.md D10)', () => {
  const wartet = (min: number) =>
    new Date(Date.parse('2026-10-18T09:00:00Z') - min * 60_000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);

  it('zwei SK I im Wartebereich: „sofort“ vor „normal“, auch bei kürzerer Wartezeit', () => {
    const personen = [
      { id: 'R-003', sichtung: 'sk1', prioritaet: 'normal', seit: wartet(20) },
      { id: 'R-005', sichtung: 'sk1', prioritaet: 'sofort', seit: wartet(5) },
    ] as const;
    expect(nachDringlichkeit(personen, (p) => p).map((p) => p.id)).toEqual(['R-005', 'R-003']);
  });

  it('die Priorität sticht keine Sichtung', () => {
    const personen = [
      { id: 'R-004', sichtung: 'sk2', prioritaet: 'sofort', seit: wartet(30) },
      { id: 'R-006', sichtung: 'sk1', prioritaet: null, seit: wartet(1) },
    ] as const;
    expect(nachDringlichkeit(personen, (p) => p).map((p) => p.id)).toEqual(['R-006', 'R-004']);
  });

  it('sofort, dringlich, normal, ohne; je Stufe die längste Wartezeit zuerst', () => {
    const personen = [
      { id: 'ohne', sichtung: 'sk2', prioritaet: undefined, seit: wartet(60) },
      { id: 'normal', sichtung: 'sk2', prioritaet: 'normal', seit: wartet(50) },
      { id: 'dringlich-jung', sichtung: 'sk2', prioritaet: 'dringlich', seit: wartet(5) },
      { id: 'sofort', sichtung: 'sk2', prioritaet: 'sofort', seit: wartet(1) },
      { id: 'dringlich-alt', sichtung: 'sk2', prioritaet: 'dringlich', seit: wartet(40) },
    ] as const;
    const folge = ['sofort', 'dringlich-alt', 'dringlich-jung', 'normal', 'ohne'];
    expect(nachDringlichkeit(personen, (p) => p).map((p) => p.id)).toEqual(folge);
    expect(transportRang('sofort')).toBe(0);
    expect(transportRang(null)).toBe(3);
  });

  it('der Sortierwert hat den Zwischenschritt und ordnet wie der Vergleich', () => {
    const reihe: DringlichkeitsMerkmale[] = [
      { sichtung: null, prioritaet: null, seit: wartet(1) },
      { sichtung: 'sk1', prioritaet: 'sofort', seit: wartet(1) },
      { sichtung: 'sk1', prioritaet: 'sofort', seit: null },
      { sichtung: 'sk1', prioritaet: 'dringlich', seit: wartet(500_000) },
      { sichtung: 'sk1', prioritaet: 'normal', seit: wartet(60) },
      { sichtung: 'sk1', prioritaet: null, seit: wartet(90) },
      { sichtung: 'sk1', prioritaet: null, seit: null },
      { sichtung: 'sk2', prioritaet: 'sofort', seit: '2020-01-01 00:00:00' },
      { sichtung: 'unverletzt', prioritaet: null, seit: null },
    ];
    const werte = reihe.map(dringlichkeitsWert);
    expect([...werte].sort((a, b) => a - b)).toEqual(werte);
    expect(new Set(werte).size).toBe(werte.length);
    for (let i = 1; i < reihe.length; i++) {
      expect(compareDringlichkeit(reihe[i - 1], reihe[i])).toBeLessThan(0);
    }
  });
});

describe('Wartezeit aus der Belegungsreihe (LLH-1135)', () => {
  it('beginnt mit dem jüngsten Eintritt', () => {
    expect(
      wartetSeit(7, [
        belegung({ id: 3, zeitpunkt_at: '2026-10-18 09:00:00' }),
        belegung({ id: 2, art: 'austritt', zeitpunkt_at: '2026-10-18 08:30:00' }),
        belegung({ id: 1, zeitpunkt_at: '2026-10-18 08:00:00' }),
      ]),
    ).toBe('2026-10-18 09:00:00');
  });

  it('beginnt neu, wenn die Person vom Platz in den Wartebereich zurückkommt', () => {
    const reihe = [
      belegung({ id: 1, zeitpunkt_at: '2026-10-18 08:00:00' }),
      belegung({ id: 2, art: 'wechsel', platz_id: 10, zeitpunkt_at: '2026-10-18 08:10:00' }),
      belegung({ id: 3, art: 'wechsel', platz_id: null, zeitpunkt_at: '2026-10-18 08:40:00' }),
    ];
    expect(wartetSeit(7, reihe)).toBe('2026-10-18 08:40:00');
    // Ein Platzwechsel danach setzt den Beginn nicht zurück.
    expect(
      wartetSeit(7, [
        ...reihe,
        belegung({ id: 4, art: 'wechsel', platz_id: 11, zeitpunkt_at: '2026-10-18 08:50:00' }),
      ]),
    ).toBe('2026-10-18 08:40:00');
  });

  it('eine Rückkehr vor dem jüngsten Eintritt zählt nicht', () => {
    expect(
      wartetSeit(7, [
        belegung({ id: 1, zeitpunkt_at: '2026-10-18 07:00:00' }),
        belegung({ id: 2, art: 'wechsel', platz_id: null, zeitpunkt_at: '2026-10-18 07:30:00' }),
        belegung({ id: 3, art: 'austritt', zeitpunkt_at: '2026-10-18 07:40:00' }),
        belegung({ id: 4, zeitpunkt_at: '2026-10-18 08:00:00' }),
      ]),
    ).toBe('2026-10-18 08:00:00');
  });

  it('wer aus einer anderen UHS herüberwechselt, wartet ab dem ersten Wechsel', () => {
    expect(
      wartetSeit(7, [
        belegung({ id: 1, art: 'wechsel', platz_id: null, zeitpunkt_at: '2026-10-18 08:00:00' }),
        belegung({ id: 2, art: 'wechsel', platz_id: 10, zeitpunkt_at: '2026-10-18 08:05:00' }),
      ]),
    ).toBe('2026-10-18 08:00:00');
  });

  it('gleiche Zeitpunkte ordnet die Kennung', () => {
    expect(
      wartetSeit(7, [
        belegung({ id: 2, art: 'wechsel', platz_id: null, zeitpunkt_at: '2026-10-18 08:00:00' }),
        belegung({ id: 1, zeitpunkt_at: '2026-10-18 08:00:00' }),
      ]),
    ).toBe('2026-10-18 08:00:00');
  });

  it('ohne Eintritt, nach dem Austritt und für andere Personen gibt es keinen Beginn', () => {
    expect(wartetSeit(7, [])).toBeNull();
    expect(wartetSeit(8, [belegung({})])).toBeNull();
    expect(
      wartetSeit(7, [
        belegung({ id: 1 }),
        belegung({ id: 2, art: 'austritt', zeitpunkt_at: '2026-10-18 08:20:00' }),
      ]),
    ).toBeNull();
  });

  it('rechnet volle Minuten in UTC, nie negativ', () => {
    const jetzt = Date.parse('2026-10-18T08:12:59Z');
    expect(wartezeitMinuten('2026-10-18 08:00:00', jetzt)).toBe(12);
    expect(wartezeitMinuten('2026-10-18 08:30:00', jetzt)).toBe(0);
    expect(wartezeitMinuten('kaputt', jetzt)).toBeNull();
  });

  it('schreibt Minuten, ab einer Stunde Stunden und Minuten', () => {
    expect(wartezeitText(0)).toBe('0 min');
    expect(wartezeitText(12)).toBe('12 min');
    expect(wartezeitText(60)).toBe('1 h 00 min');
    expect(wartezeitText(135)).toBe('2 h 15 min');
  });
});

describe('gehaltene Folge der Schleuse (LLH-1135)', () => {
  const p = (id: number, wort = `v${id}`) => ({ id, wort });

  it('offen (ohne gehaltene Folge) gilt die frische Folge', () => {
    const frisch = [p(2), p(1)];
    expect(gehalteneFolge(null, frisch, (x) => x.id)).toBe(frisch);
  });

  it('hält die Folge, der Inhalt kommt frisch, Entfallenes fällt weg, Neues steht hinten', () => {
    const frisch = [p(3), p(4, 'neu'), p(1, 'frisch')];
    expect(gehalteneFolge([1, 2, 3], frisch, (x) => x.id)).toEqual([
      p(1, 'frisch'),
      p(3),
      p(4, 'neu'),
    ]);
  });
});
