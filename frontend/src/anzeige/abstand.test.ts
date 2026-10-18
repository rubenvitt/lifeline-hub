import { describe, expect, it } from 'vitest';
import { formatVor } from './abstand';

/** „vor n min“ für den Patientenkopf (LLH-1094); getaktet über `useMinutenTakt`. */
describe('formatVor', () => {
  const jetzt = Date.parse('2026-10-18T10:00:00Z');
  const vor = (ms: number) => formatVor(new Date(jetzt - ms).toISOString(), jetzt);

  it('nennt unter einer Minute „gerade eben“', () => {
    expect(vor(0)).toBe('gerade eben');
    expect(vor(59_000)).toBe('gerade eben');
  });

  it('zählt ganze Minuten', () => {
    expect(vor(60_000)).toBe('vor 1 min');
    expect(vor(42 * 60_000 + 30_000)).toBe('vor 42 min');
  });

  it('nennt ab einer Stunde Stunden und Minuten', () => {
    expect(vor(60 * 60_000)).toBe('vor 1 h');
    expect(vor((3 * 60 + 5) * 60_000)).toBe('vor 3 h 5 min');
  });

  it('nimmt Server-Zeitstempel ohne Zone als UTC', () => {
    expect(formatVor('2026-10-18 09:18:00', jetzt)).toBe('vor 42 min');
  });

  it('meldet eine Zeit in der Zukunft als „gerade eben“ statt mit Minus', () => {
    expect(vor(-120_000)).toBe('gerade eben');
  });

  it('liefert ohne Zeitpunkt nichts', () => {
    expect(formatVor(null, jetzt)).toBe('');
  });
});
