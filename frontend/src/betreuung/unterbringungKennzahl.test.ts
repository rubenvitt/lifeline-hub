import { describe, expect, it } from 'vitest';
import type { Betreuungsstelle, BetreuungsstelleStatus } from '../api/types';
import { unterbringungKennzahl } from './unterbringungKennzahl';

/**
 * „Unterbringung in Zahlen" der Betreuungsübersicht (LLH-1050): je Festlegung ein Test. Dieselben
 * Regeln wie `evakuierungKennzahl.test.ts` — Abwesenheit statt 0.
 */

let naechsteId = 1;

function stelle(
  opt: {
    kapazitaet?: number;
    belegt?: number;
    status?: BetreuungsstelleStatus;
  } = {},
): Betreuungsstelle {
  const id = naechsteId++;
  return {
    id,
    einsatz_id: 1,
    bezeichnung: `Stelle ${id}`,
    art: 'notunterkunft',
    status: opt.status ?? 'in_betrieb',
    angelegt_at: '2026-09-23 08:00:00',
    ...(opt.kapazitaet !== undefined && { kapazitaet_personen: opt.kapazitaet }),
    ...(opt.belegt !== undefined && {
      belegung: { id: 100 + id, belegt: opt.belegt, zeitpunkt_at: '2026-09-23 10:00:00' },
    }),
  };
}

describe('unterbringungKennzahl (LLH-1050)', () => {
  it('ohne Stelle gibt es keine Kennzahl — das Band entfällt, die Seite zeigt den Leerzustand', () => {
    expect(unterbringungKennzahl([])).toBeNull();
  });

  it('keine Meldung → „in Betreuung" ist null, nicht 0', () => {
    const k = unterbringungKennzahl([stelle({ kapazitaet: 100 }), stelle()])!;
    expect(k.inBetreuung).toBeNull();
    expect(k.ohneMeldung).toBe(2);
  });

  it('„in Betreuung" summiert die aktuellen Belegungen; eine Meldung 0 ist eine Zahl', () => {
    const k = unterbringungKennzahl([stelle({ belegt: 0 }), stelle({ belegt: 40 }), stelle()])!;
    expect(k.inBetreuung).toBe(40);
    expect(k.ohneMeldung).toBe(1);
  });

  it('„ohne Meldung" zählt nur Stellen in Betrieb — wie die Kopfzahl des Servers (LFH-679)', () => {
    const k = unterbringungKennzahl([
      stelle({ status: 'vorbereitet' }),
      stelle({ status: 'geschlossen' }),
      stelle({ status: 'in_betrieb' }),
    ])!;
    expect(k.ohneMeldung).toBe(1);
  });

  it('Kapazität nur aus Stellen mit Kapazität; die übrigen stehen als „ohne Kapazität"', () => {
    const k = unterbringungKennzahl([
      stelle({ kapazitaet: 150, belegt: 89 }),
      stelle({ kapazitaet: 80 }),
      stelle({ belegt: 12 }),
    ])!;
    expect(k.kapazitaet).toBe(230);
    expect(k.ohneKapazitaet).toBe(1);
  });

  it('ohne jede Kapazität ist „Kapazität" null, nicht 0, und „Frei" ebenso', () => {
    const k = unterbringungKennzahl([stelle({ belegt: 12 }), stelle()])!;
    expect(k.kapazitaet).toBeNull();
    expect(k.frei).toBeNull();
    expect(k.ohneKapazitaet).toBe(2);
  });

  it('Frei ist nie negativ — je Stelle gekappt, eine Überbelegung nimmt anderen keinen Platz', () => {
    const k = unterbringungKennzahl([
      stelle({ kapazitaet: 40, belegt: 52 }), // überbelegt: 0 frei, nicht −12
      stelle({ kapazitaet: 150, belegt: 89 }), // 61 frei
    ])!;
    expect(k.frei).toBe(61);
    const nurUeber = unterbringungKennzahl([stelle({ kapazitaet: 40, belegt: 52 })])!;
    expect(nurUeber.frei).toBe(0);
  });

  it('eine Stelle mit Kapazität ohne Meldung zählt nicht in „Frei", sondern steht als ungemeldet', () => {
    const k = unterbringungKennzahl([
      stelle({ kapazitaet: 150, belegt: 89 }),
      stelle({ kapazitaet: 80 }),
    ])!;
    expect(k.frei).toBe(61);
    expect(k.freiOhneMeldung).toBe(1);
    // Nur ungemeldete: der Platz ist unbekannt, nicht 0 und nicht die ganze Kapazität.
    const nurUngemeldet = unterbringungKennzahl([stelle({ kapazitaet: 80 })])!;
    expect(nurUngemeldet.frei).toBeNull();
    expect(nurUngemeldet.freiOhneMeldung).toBe(1);
  });

  it('geschlossene Stellen zählen nicht in „Kapazität" und „Frei"', () => {
    const k = unterbringungKennzahl([
      stelle({ kapazitaet: 150, belegt: 89 }),
      stelle({ kapazitaet: 200, belegt: 0, status: 'geschlossen' }),
      stelle({ status: 'geschlossen' }), // ohne Kapazität: auch nicht „ohne Kapazität"
    ])!;
    expect(k.kapazitaet).toBe(150);
    expect(k.frei).toBe(61);
    expect(k.ohneKapazitaet).toBe(0);
    expect(k.freiOhneMeldung).toBe(0);
  });

  it('eine vorbereitete Stelle trägt ihre Kapazität bei — sie ist nicht geschlossen', () => {
    const k = unterbringungKennzahl([stelle({ kapazitaet: 60, status: 'vorbereitet' })])!;
    expect(k.kapazitaet).toBe(60);
  });

  it('Stellen in Betrieb: n von m, m sind alle Stellen der Übersicht', () => {
    const k = unterbringungKennzahl([
      stelle({ status: 'in_betrieb' }),
      stelle({ status: 'vorbereitet' }),
      stelle({ status: 'geschlossen' }),
    ])!;
    expect(k.inBetrieb).toBe(1);
    expect(k.stellen).toBe(3);
  });

  it('voll oder überbelegt zählt, „fast voll" nicht', () => {
    const k = unterbringungKennzahl([
      stelle({ kapazitaet: 80, belegt: 80 }), // voll
      stelle({ kapazitaet: 40, belegt: 52 }), // überbelegt
      stelle({ kapazitaet: 150, belegt: 140 }), // fast voll
      stelle({ belegt: 500 }), // ohne Kapazität: keine Einstufung
    ])!;
    expect(k.voll).toBe(2);
  });

  it('„davon namentlich" fehlt ohne Personenrecht ganz — nicht 0', () => {
    const k = unterbringungKennzahl([stelle({ belegt: 10 })])!;
    expect(k).not.toHaveProperty('namentlich');
    const leer = unterbringungKennzahl([stelle({ belegt: 10 })], null)!;
    expect(leer).not.toHaveProperty('namentlich');
  });

  it('„davon namentlich" summiert mit Personenrecht, auch zu 0', () => {
    const a = stelle({ belegt: 10 });
    const b = stelle();
    const k = unterbringungKennzahl(
      [a, b],
      [
        { stelle_id: a.id, anzahl: 2 },
        { stelle_id: b.id, anzahl: 3 },
      ],
    )!;
    expect(k.namentlich).toBe(5);
    expect(unterbringungKennzahl([a], [])!.namentlich).toBe(0);
  });
});
