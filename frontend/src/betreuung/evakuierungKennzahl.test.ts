import { describe, expect, it } from 'vitest';
import type { Erhebung, Evakuierungsbezirk, Raeumungszustand } from '../api/types';
import { evakuierungKennzahl, istAktiverBezirk } from './evakuierungKennzahl';

/**
 * Kennzahl „Evakuiert N · von M geplant" (LFH-639, spec.md Requirement „Kennzahl …",
 * design.md D9). Jedes Spec-Szenario steht hier als eigener Test; die Zahlen sind die der
 * Spec. Der Fall „Abruffehler" gehört dem Hook und steht in `useEvakuierungKennzahl.test.tsx`.
 */

let naechsteId = 1;

function bezirk(
  plan: number,
  opt: {
    stand?: number;
    standErhebung?: Erhebung;
    planErhebung?: Erhebung;
    raeumung?: Raeumungszustand;
    storniert?: boolean;
  } = {},
): Evakuierungsbezirk {
  const id = naechsteId++;
  return {
    id,
    einsatz_id: 1,
    bezeichnung: `Bezirk ${id}`,
    plan_personen: plan,
    plan_erhebung: opt.planErhebung ?? 'gezaehlt',
    raeumung: opt.raeumung ?? 'laeuft',
    angelegt_at: '2026-09-23 08:00:00',
    ...(opt.stand !== undefined && {
      stand: {
        id: 100 + id,
        evakuiert: opt.stand,
        erhebung: opt.standErhebung ?? 'gezaehlt',
        zeitpunkt_at: '2026-09-23 10:00:00',
      },
    }),
    ...(opt.storniert && { storniert_at: '2026-09-23 09:00:00' }),
  };
}

describe('evakuierungKennzahl — Spec-Szenarien', () => {
  it('Zwei Bezirke: 600 + 720 von 640 + 1 210, nicht geschätzt', () => {
    expect(
      evakuierungKennzahl([bezirk(640, { stand: 600 }), bezirk(1210, { stand: 720 })]),
    ).toEqual({ evakuiert: 1320, geplant: 1850, bezirke: 2, ohneMeldung: 0, geschaetzt: false });
  });

  it('Keine geplante Evakuierung: kein Bezirk → keine Kennzahl', () => {
    expect(evakuierungKennzahl([])).toBeNull();
  });

  it('Keine geplante Evakuierung: alle Bezirke storniert oder aufgehoben → keine Kennzahl', () => {
    expect(
      evakuierungKennzahl([
        bezirk(640, { stand: 600, storniert: true }),
        bezirk(1210, { stand: 720, raeumung: 'aufgehoben' }),
      ]),
    ).toBeNull();
  });

  it('Bezirk ohne Meldung geht nicht als 0 in N ein, sondern wird ausgewiesen; M zählt ihn mit', () => {
    expect(evakuierungKennzahl([bezirk(640, { stand: 600 }), bezirk(1210)])).toEqual({
      evakuiert: 600,
      geplant: 1850,
      bezirke: 2,
      ohneMeldung: 1,
      geschaetzt: false,
    });
  });

  it('Geschätzter Anteil: ein geschätzter Stand kennzeichnet die Kennzahl', () => {
    const k = evakuierungKennzahl([
      bezirk(640, { stand: 600 }),
      bezirk(1210, { stand: 720, standErhebung: 'geschaetzt' }),
    ]);
    expect(k?.geschaetzt).toBe(true);
  });
});

describe('evakuierungKennzahl — Randfälle', () => {
  it('eine geschätzte Plangröße allein kennzeichnet die Kennzahl ebenfalls', () => {
    const k = evakuierungKennzahl([bezirk(640, { stand: 600, planErhebung: 'geschaetzt' })]);
    expect(k?.geschaetzt).toBe(true);
  });

  it('ein aufgehobener oder stornierter Bezirk mit geschätzten Werten färbt nicht ab', () => {
    const k = evakuierungKennzahl([
      bezirk(640, { stand: 600 }),
      bezirk(300, { stand: 50, standErhebung: 'geschaetzt', raeumung: 'aufgehoben' }),
      bezirk(200, { planErhebung: 'geschaetzt', storniert: true }),
    ]);
    expect(k).toEqual({
      evakuiert: 600,
      geplant: 640,
      bezirke: 1,
      ohneMeldung: 0,
      geschaetzt: false,
    });
  });

  it('ein geräumter Bezirk zählt mit — erst „aufgehoben" nimmt ihn heraus', () => {
    expect(
      evakuierungKennzahl([bezirk(640, { stand: 640, raeumung: 'geraeumt' })])?.evakuiert,
    ).toBe(640);
  });

  it('N wird nicht auf M gedeckelt', () => {
    expect(evakuierungKennzahl([bezirk(640, { stand: 700 })])).toMatchObject({
      evakuiert: 700,
      geplant: 640,
    });
  });

  it('ein gemeldeter Stand 0 ist eine Zahl, keine fehlende Meldung', () => {
    expect(evakuierungKennzahl([bezirk(640, { stand: 0 })])).toMatchObject({
      evakuiert: 0,
      ohneMeldung: 0,
    });
  });

  it('ohne jede Meldung ist N `null`, nicht 0 — „nichts gemeldet" ist nicht „niemand evakuiert"', () => {
    expect(evakuierungKennzahl([bezirk(640), bezirk(1210)])).toEqual({
      evakuiert: null,
      geplant: 1850,
      bezirke: 2,
      ohneMeldung: 2,
      geschaetzt: false,
    });
  });
});

describe('istAktiverBezirk', () => {
  it('ist aktiv, solange weder storniert noch aufgehoben', () => {
    expect(istAktiverBezirk(bezirk(1, { raeumung: 'angeordnet' }))).toBe(true);
    expect(istAktiverBezirk(bezirk(1, { raeumung: 'laeuft' }))).toBe(true);
    expect(istAktiverBezirk(bezirk(1, { raeumung: 'geraeumt' }))).toBe(true);
    expect(istAktiverBezirk(bezirk(1, { raeumung: 'aufgehoben' }))).toBe(false);
    expect(istAktiverBezirk(bezirk(1, { storniert: true }))).toBe(false);
  });
});
