import { describe, expect, it, beforeEach } from 'vitest';
import { waehleDefaultUhs, merkeLetzteUhs, liesLetzteUhs } from './uhsAuswahl';
import type { Uhs, UhsStatus } from '../../api/types';

function uhs(id: number, status: UhsStatus): Uhs {
  return {
    id, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
    bezeichnung: `UHS ${id}`, standort: null, notiz: null, lat: null, lon: null, status,
    erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
  };
}

describe('waehleDefaultUhs', () => {
  it('liefert null bei leerer Liste', () => {
    expect(waehleDefaultUhs([], null)).toBeNull();
  });

  it('bevorzugt die zuletzt ausgewählte UHS — auch vor einer aktiven', () => {
    const liste = [uhs(1, 'aktiv'), uhs(2, 'geplant')];
    expect(waehleDefaultUhs(liste, 2)).toBe(2);
  });

  it('ignoriert die zuletzt ausgewählte, wenn sie nicht mehr in der Liste ist', () => {
    const liste = [uhs(3, 'aktiv'), uhs(1, 'aktiv')];
    expect(waehleDefaultUhs(liste, 99)).toBe(1); // fällt auf älteste aktive zurück
  });

  it('wählt die älteste aktive (kleinste id), wenn keine zuletzt ausgewählte', () => {
    const liste = [uhs(5, 'aktiv'), uhs(2, 'aktiv'), uhs(8, 'geplant')];
    expect(waehleDefaultUhs(liste, null)).toBe(2);
  });

  it('wählt die zuletzt angelegte (größte id), wenn keine aktive existiert', () => {
    const liste = [uhs(2, 'geplant'), uhs(7, 'aufgeloest'), uhs(4, 'geplant')];
    expect(waehleDefaultUhs(liste, null)).toBe(7);
  });
});

describe('letzte-UHS-Speicher', () => {
  beforeEach(() => localStorage.clear());

  it('merkt und liest die zuletzt ausgewählte UHS pro Einsatz', () => {
    merkeLetzteUhs(1, 42);
    merkeLetzteUhs(2, 7);
    expect(liesLetzteUhs(1)).toBe(42);
    expect(liesLetzteUhs(2)).toBe(7);
  });

  it('liefert null, wenn für den Einsatz noch nichts gemerkt wurde', () => {
    expect(liesLetzteUhs(99)).toBeNull();
  });
});
