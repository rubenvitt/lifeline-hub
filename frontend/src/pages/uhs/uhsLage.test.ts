import { describe, expect, it } from 'vitest';
import type { Person, UhsBelegung, UhsDetail, UhsPlatz } from '../../api/types';
import { ausgetretenSeit, platzZahlen, unterwegsAus, uhsLage } from './uhsLage';

/**
 * Lage der Stelle in Zahlen (LLH-1136): abgeleitet aus Personen und UHS-Detail, dieselben Mengen
 * wie der Grundriss. Gegenprobe: wer die Stelle auf Transport verlässt, zählt nicht mehr in der
 * Stelle, sondern bei den Abtransporten.
 */
const platz = (teil: Partial<UhsPlatz>): UhsPlatz =>
  ({
    id: 1,
    uhs_id: 3,
    typ: 'behandlungsplatz',
    bezeichnung: 'BHP',
    verfuegbarkeit: 'frei',
    storniert_at: null,
    ...teil,
  }) as UhsPlatz;

const person = (teil: Partial<Person>): Person =>
  ({
    id: 1,
    einsatz_id: 1,
    registrier_nr: 1,
    status: 'betroffen',
    aktuelle_sichtung: null,
    aktuelle_uhs_id: 3,
    aktueller_platz_id: null,
    aktueller_verbleib: null,
    storniert_at: null,
    erfasst_at: '2026-10-18 08:00:00',
    ...teil,
  }) as Person;

const schritt = (teil: Partial<UhsBelegung>): UhsBelegung =>
  ({
    id: 1,
    uhs_id: 3,
    person_id: 1,
    art: 'eintritt',
    platz_id: null,
    zeitpunkt_at: '2026-10-18 09:00:00',
    ...teil,
  }) as UhsBelegung;

const uhs = (belegungen: UhsBelegung[]): UhsDetail =>
  ({
    id: 3,
    plaetze: [
      platz({ id: 10 }),
      platz({ id: 11 }),
      platz({ id: 12, verfuegbarkeit: 'aufbereitung' }),
      platz({ id: 13, verfuegbarkeit: 'defekt' }),
      platz({ id: 14, storniert_at: '2026-10-18 08:00:00' }),
      platz({ id: 15, typ: 'wartebereich' }),
    ],
    belegungen,
  }) as UhsDetail;

// 09:00 + 34 min
const JETZT = Date.parse('2026-10-18T09:34:00Z');

const personen = [
  person({ id: 1, aktuelle_sichtung: 'sk1', aktueller_platz_id: 10 }),
  person({ id: 2, aktuelle_sichtung: 'sk2' }),
  person({ id: 3, aktuelle_sichtung: 'sk2' }),
  person({ id: 4, aktuelle_sichtung: null }),
  // Eine andere Stelle zählt nicht.
  person({ id: 5, aktuelle_uhs_id: 9, aktuelle_sichtung: 'sk1' }),
];
const belegungen = [
  schritt({ id: 1, person_id: 1, zeitpunkt_at: '2026-10-18 09:00:00' }),
  schritt({
    id: 2,
    person_id: 1,
    art: 'wechsel',
    platz_id: 10,
    zeitpunkt_at: '2026-10-18 09:05:00',
  }),
  schritt({ id: 3, person_id: 2, zeitpunkt_at: '2026-10-18 09:00:00' }),
  schritt({ id: 4, person_id: 3, zeitpunkt_at: '2026-10-18 09:20:00' }),
  schritt({ id: 5, person_id: 4, zeitpunkt_at: '2026-10-18 09:30:00' }),
];

describe('uhsLage (LLH-1136)', () => {
  it('zählt Personen je Sichtung, freie Plätze, Wartende mit längster Wartezeit und Abtransporte', () => {
    const lage = uhsLage(uhs(belegungen), personen, JETZT);
    expect(lage.inDerStelle).toBe(4);
    expect(lage.sichtung).toMatchObject({ sk1: 1, sk2: 2, ohne: 1 });
    expect(lage.plaetze).toEqual({
      gesamt: 4,
      belegt: 1,
      frei: 1,
      nichtVerfuegbar: 2,
      inAufbereitung: 1,
    });
    expect(lage.wartend).toBe(3);
    expect(lage.laengsteWarteMin).toBe(34);
    expect(lage.unterwegs).toBe(0);
  });

  it('Gegenprobe: wer in den Eigentransport geht, verlässt die Stelle und zählt als unterwegs', () => {
    const vorher = uhsLage(uhs(belegungen), personen, JETZT);
    const nachher = uhsLage(
      uhs([
        ...belegungen,
        schritt({ id: 6, person_id: 2, art: 'austritt', zeitpunkt_at: '2026-10-18 09:33:00' }),
      ]),
      personen.map((p) =>
        p.id === 2
          ? {
              ...p,
              aktuelle_uhs_id: null,
              aktueller_verbleib: 'Eigentransport 1/83-1 → KH Mitte',
              versorgung: 'unterwegs' as const,
            }
          : p,
      ),
      JETZT,
    );
    expect(nachher.inDerStelle).toBe(vorher.inDerStelle - 1);
    expect(nachher.wartend).toBe(vorher.wartend - 1);
    expect(nachher.sichtung.sk2).toBe(1);
    expect(nachher.unterwegs).toBe(vorher.unterwegs + 1);
    // Die längste Wartende war Person 2 (seit 09:00); jetzt wartet Person 3 am längsten.
    expect(nachher.laengsteWarteMin).toBe(14);
  });

  it('wer auf einem Platz vom Typ Wartebereich steht, zählt als wartend', () => {
    const lage = uhsLage(
      uhs([schritt({ id: 1, person_id: 6, zeitpunkt_at: '2026-10-18 09:04:00' })]),
      [person({ id: 6, aktueller_platz_id: 15 })],
      JETZT,
    );
    expect(lage).toMatchObject({ inDerStelle: 1, wartend: 1, laengsteWarteMin: 30 });
    // Der Wartebereich-Platz ist kein Behandlungsplatz: die Plätze bleiben unberührt.
    expect(lage.plaetze).toMatchObject({ gesamt: 4, belegt: 0 });
  });

  it('ohne Wartende gibt es keine längste Wartezeit', () => {
    const lage = uhsLage(uhs([]), [], JETZT);
    expect(lage).toMatchObject({ inDerStelle: 0, wartend: 0, laengsteWarteMin: null });
  });

  it('Unterwegs: nur wer aus DIESER Stelle austrat und im Eigentransport ist', () => {
    const p = [
      person({ id: 7, aktuelle_uhs_id: null, versorgung: 'unterwegs' }),
      person({ id: 8, aktuelle_uhs_id: null, versorgung: 'abgeschlossen' }),
      person({ id: 9, aktuelle_uhs_id: null, versorgung: 'unterwegs' }),
      person({ id: 10, aktuelle_uhs_id: null, versorgung: 'abgeschlossen' }),
    ];
    const u = uhs([
      schritt({ id: 1, person_id: 7, art: 'austritt' }),
      schritt({ id: 2, person_id: 8, art: 'austritt' }),
      // An ein fremdes Rettungsmittel übergeben: abgeschlossen, nicht unterwegs.
      schritt({ id: 3, person_id: 10, art: 'austritt' }),
    ]);
    expect(unterwegsAus(u, p).map((x) => x.id)).toEqual([7]);
  });

  it('ausgetretenSeit: der jüngste Austritt der Person, sonst null', () => {
    const reihe = [
      schritt({ id: 1, person_id: 7, art: 'austritt', zeitpunkt_at: '2026-10-18 09:00:00' }),
      schritt({ id: 2, person_id: 7, art: 'eintritt', zeitpunkt_at: '2026-10-18 09:10:00' }),
      schritt({ id: 3, person_id: 7, art: 'austritt', zeitpunkt_at: '2026-10-18 09:20:00' }),
      schritt({ id: 4, person_id: 8, art: 'austritt', zeitpunkt_at: '2026-10-18 09:30:00' }),
    ];
    expect(ausgetretenSeit(7, reihe)).toBe('2026-10-18 09:20:00');
    expect(ausgetretenSeit(9, reihe)).toBeNull();
  });

  it('platzZahlen: belegt vor Verfügbarkeit, Wartebereich und stornierte zählen nicht', () => {
    expect(platzZahlen(uhs([]), new Set([10, 12]))).toEqual({
      gesamt: 4,
      belegt: 2,
      frei: 1,
      nichtVerfuegbar: 1,
      inAufbereitung: 0,
    });
  });
});
