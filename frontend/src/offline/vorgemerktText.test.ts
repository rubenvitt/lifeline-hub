import { describe, expect, it } from 'vitest';
import { vorgemerktDauer, vorgemerktText } from './vorgemerktText';

describe('vorgemerktText (LLH-1758)', () => {
  it('ohne Netz bleibt der bisherige Satz', () => {
    expect(vorgemerktText('offline', 'Meldung von Leitstelle')).toBe(
      'Offline vorgemerkt: Meldung von Leitstelle',
    );
    expect(vorgemerktText('offline', 'R-…', ' · ')).toBe('Offline vorgemerkt · R-…');
    expect(vorgemerktText('offline', '')).toBe('Offline vorgemerkt');
  });

  it('ein Serverfehler heißt nicht offline und sagt, dass erneut gesendet wird', () => {
    expect(vorgemerktText('serverfehler', 'Meldung von Leitstelle')).toBe(
      'Server-Fehler – Meldung von Leitstelle vorgemerkt, wird erneut gesendet',
    );
    expect(vorgemerktText('serverfehler', 'R-…', ' · ')).toBe(
      'Server-Fehler – R-… vorgemerkt, wird erneut gesendet',
    );
    expect(vorgemerktText('serverfehler', '')).toBe(
      'Server-Fehler – vorgemerkt, wird erneut gesendet',
    );
  });

  it('ein Serverfehler steht länger', () => {
    expect(vorgemerktDauer('serverfehler')).toBe(8);
    expect(vorgemerktDauer('offline')).toBeUndefined();
  });
});
