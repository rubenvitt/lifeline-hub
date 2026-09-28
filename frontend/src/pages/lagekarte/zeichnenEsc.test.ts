import { describe, expect, it } from 'vitest';
import { escStufe, type EscLage } from './zeichnenEsc';

const basis: EscLage = {
  phase: 'zeichnen',
  speichernLaeuft: false,
  punkte: 0,
  serieGespeichert: 0,
};

describe('escStufe (LFH-712)', () => {
  it('Zeichenphase mit Punkten: Figur verwerfen, Modus bleibt', () => {
    expect(escStufe({ ...basis, punkte: 3 })).toBe('verwerfen');
    expect(escStufe({ ...basis, punkte: 1 })).toBe('verwerfen');
  });

  it('Zeichenphase ohne Punkte: Modus beenden', () => {
    expect(escStufe(basis)).toBe('abbrechen');
  });

  it('ohne Punkte in einer Serie mit Gespeichertem: wie „Fertig"', () => {
    expect(escStufe({ ...basis, serieGespeichert: 2 })).toBe('fertig');
  });

  it('Bestätigungsphase: zurück ins Zeichnen, unabhängig vom Punktstand', () => {
    expect(escStufe({ ...basis, phase: 'bestaetigen', punkte: 0 })).toBe('zurueckZumZeichnen');
    expect(escStufe({ ...basis, phase: 'bestaetigen', punkte: 4, serieGespeichert: 1 })).toBe(
      'zurueckZumZeichnen',
    );
  });

  it('solange gespeichert wird, tut Esc nichts — in jeder Phase', () => {
    expect(escStufe({ ...basis, speichernLaeuft: true, phase: 'bestaetigen' })).toBe('nichts');
    expect(escStufe({ ...basis, speichernLaeuft: true, punkte: 3 })).toBe('nichts');
  });
});
