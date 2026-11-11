import { describe, expect, it } from 'vitest';
import type { FuehrungAnzeige, FuehrungGegenueber } from '../api/types';
import { FUEHRUNG_ART_TEXT, fuehrungBeiKurz, fuehrungKurz, fuehrungMoeglich } from './fuehrungText';

const hub: FuehrungGegenueber = {
  kopplung_id: 1,
  kennung: 'k-hub',
  name: 'Hub Nord',
  richtung: 'meldet_sich',
};
const elw: FuehrungGegenueber = {
  kopplung_id: 2,
  kennung: 'k-elw',
  name: 'ELW 1',
  richtung: 'wird_gemeldet',
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
    expect(Object.keys(FUEHRUNG_ART_TEXT)).toHaveLength(8);
  });
});

describe('fuehrungMoeglich (LLH-1491)', () => {
  it('führend: übergeben an jedes Gegenüber, per Code nur an die erreichte Seite', () => {
    const m = fuehrungMoeglich(akte({ gegenueber: [hub, elw] }));
    expect(m.uebergeben.map((g) => g.name)).toEqual(['Hub Nord', 'ELW 1']);
    expect(m.perCode.map((g) => g.name)).toEqual(['Hub Nord']);
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

  it('führt die meldende Seite: Notübernahme nur mit Unterschrift oder Code', () => {
    const m = fuehrungMoeglich(akte({ fuehrend: false, fuehrer_richtung: 'wird_gemeldet' }));
    expect(m.notuebernahmeMitBeweis).toBe(true);
    expect(m.notuebernahme).toBe(false);
    expect(m.anfragen).toBe(false);
  });

  it('eine offene Übernahme sperrt die Übergabe und verlangt die Entscheidung', () => {
    const m = fuehrungMoeglich(
      akte({ offen: { von: 'Hub Nord', epoche: 2, bruch_at: '2026-11-09 14:00:00' } }),
    );
    expect(m.entscheiden).toBe(true);
    expect(m.uebergeben).toEqual([]);
    expect(m.perCode).toEqual([]);
  });
});
