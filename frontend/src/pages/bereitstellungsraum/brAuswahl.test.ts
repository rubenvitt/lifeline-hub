import { describe, expect, it, beforeEach } from 'vitest';
import { waehleDefaultBr, merkeLetztenBr, liesLetztenBr } from './brAuswahl';
import type { Bereitstellungsraum, BrStatus } from '../../api/types';

function br(id: number, status: BrStatus, over: Partial<Bereitstellungsraum> = {}): Bereitstellungsraum {
  return {
    id, einsatz_id: 1, abschnitt_id: null, bezeichnung: `BR ${id}`,
    standort: null, notiz: null, status,
    erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1,
    storniert_at: null,
    ...over,
  };
}

describe('waehleDefaultBr', () => {
  it('liefert null bei leerer Liste', () => {
    expect(waehleDefaultBr([], null)).toBeNull();
  });

  it('bevorzugt den zuletzt ausgewählten BR — auch vor einem aktiven', () => {
    const liste = [br(1, 'aktiv'), br(2, 'geplant')];
    expect(waehleDefaultBr(liste, 2)).toBe(2);
  });

  it('ignoriert den zuletzt ausgewählten, wenn er nicht mehr in der Liste ist', () => {
    const liste = [br(3, 'aktiv'), br(1, 'aktiv')];
    expect(waehleDefaultBr(liste, 99)).toBe(1); // fällt auf ältesten aktiven zurück
  });

  it('wählt den ältesten aktiven (kleinste id), wenn keiner zuletzt ausgewählt wurde', () => {
    const liste = [br(5, 'aktiv'), br(2, 'aktiv'), br(8, 'geplant')];
    expect(waehleDefaultBr(liste, null)).toBe(2);
  });

  it('wählt den zuletzt angelegten (größte id), wenn keiner aktiv ist', () => {
    const liste = [br(2, 'geplant'), br(7, 'aufgeloest'), br(4, 'geplant')];
    expect(waehleDefaultBr(liste, null)).toBe(7);
  });

  it('behandelt einen stornierten aktiven BR nicht als aktiv', () => {
    const liste = [br(3, 'aktiv', { storniert_at: '2026-08-28 10:00:00' }), br(1, 'geplant')];
    // Kein "aktiver" BR übrig (der einzige aktive ist storniert) → Fallback auf größte id.
    expect(waehleDefaultBr(liste, null)).toBe(3);
  });
});

describe('letzter-BR-Speicher', () => {
  beforeEach(() => localStorage.clear());

  it('merkt und liest den zuletzt ausgewählten BR pro Einsatz', () => {
    merkeLetztenBr(1, 42);
    merkeLetztenBr(2, 7);
    expect(liesLetztenBr(1)).toBe(42);
    expect(liesLetztenBr(2)).toBe(7);
  });

  it('liefert null, wenn für den Einsatz noch nichts gemerkt wurde', () => {
    expect(liesLetztenBr(99)).toBeNull();
  });
});
