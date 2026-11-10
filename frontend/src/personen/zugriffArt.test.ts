import { describe, expect, it } from 'vitest';
import type { PersonZugriff } from '../api/types';
import { ZUGRIFF_ART_TEXT, zugriffArtText } from './zugriffArt';
import { ZUGRIFF_SPALTEN } from './zugriffSpalten';

describe('zugriffArtText (LFH-757)', () => {
  it('nennt jede Art des Zugriffsprotokolls im Klartext', () => {
    expect(ZUGRIFF_ART_TEXT).toEqual({
      detail: 'Detail geöffnet',
      export: 'Liste exportiert',
      druck: 'Liste gedruckt',
      anhang: 'Datei geladen',
      registrierliste: 'Registrierliste gedruckt',
    });
    expect(zugriffArtText({ art: 'anhang', person_id: 9 })).toBe('Datei geladen');
    // LLH-1616: der Druck der Registrierliste steht je Person, getrennt vom Personenblatt.
    expect(zugriffArtText({ art: 'registrierliste', person_id: 9 })).toBe(
      'Registrierliste gedruckt',
    );
  });

  it('unterscheidet den Druck einer Person vom Druck der Liste (LLH-1120)', () => {
    // Die Druckansicht einer Person schreibt `druck` MIT `person_id`, der Listendruck ohne.
    expect(zugriffArtText({ art: 'druck', person_id: 9 })).toBe('Blatt gedruckt');
    expect(zugriffArtText({ art: 'druck', person_id: null })).toBe('Liste gedruckt');
  });

  it('die Spalte „Art“ nennt den Einzeldruck als „Blatt gedruckt“', () => {
    const spalte = ZUGRIFF_SPALTEN.find((s) => s.key === 'art')!;
    const zeile = (person_id: number | null): PersonZugriff => ({
      id: 1,
      person_id,
      benutzer_id: 2,
      benutzer_name: 'A. Leitung',
      art: 'druck',
      zugriff_at: '2026-10-19 10:00:00',
    });
    expect(spalte.render?.('druck', zeile(9), 0)).toBe('Blatt gedruckt');
    expect(spalte.render?.('druck', zeile(null), 0)).toBe('Liste gedruckt');
  });
});
