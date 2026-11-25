import { describe, expect, it } from 'vitest';
import { helferHinweis } from './helferZustellung';

describe('helferHinweis', () => {
  it('nennt die Zahl der Helfer-Apps, an die die Zeile ging', () => {
    expect(helferHinweis({ helfer_gesendet: 2, quittiert_at: null })).toBe(
      'an 2 Helfer-Apps gesendet',
    );
    expect(helferHinweis({ helfer_gesendet: 1, quittiert_at: null })).toBe(
      'an 1 Helfer-App gesendet',
    );
  });

  it('schweigt ohne Helfer-App', () => {
    expect(helferHinweis({ helfer_gesendet: 0, quittiert_at: null })).toBeNull();
    expect(helferHinweis({ helfer_gesendet: null, quittiert_at: null })).toBeNull();
    expect(helferHinweis({ quittiert_at: null })).toBeNull();
  });

  it('nennt den quittierenden Helfer statt der Zahl', () => {
    expect(
      helferHinweis({
        helfer_gesendet: 2,
        quittiert_at: '2026-11-25 14:32:00',
        quittiert_von_helfer: 'Max M.',
      }),
    ).toBe('quittiert von Max M. (Helfer-App)');
  });
});
