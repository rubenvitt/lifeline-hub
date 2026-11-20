import { describe, expect, it } from 'vitest';
import { ApiError, NetzFehler } from '../api/client';
import { istOfflineTransient, vormerkGrund } from './fehler';

describe('istOfflineTransient', () => {
  it('hält Netzfehler, Sitzungskonflikte und Überlast in der Queue', () => {
    expect(istOfflineTransient(new NetzFehler())).toBe(true);
    for (const status of [401, 408, 412, 429, 500, 503]) {
      expect(istOfflineTransient(new ApiError(status, 'x')), String(status)).toBe(true);
    }
  });

  // LFH-1074: Ein zu großer Body wird beim nächsten Versuch nicht kleiner; der Eintrag wird
  // sichtbar abgelehnt statt endlos neu gesendet.
  it('lehnt einen zu großen Body (413) dauerhaft ab wie jeden Feldfehler', () => {
    for (const status of [400, 413, 422]) {
      expect(
        istOfflineTransient(new ApiError(status, 'Anfrage ist zu groß.')),
        String(status),
      ).toBe(false);
    }
  });
});

describe('vormerkGrund (LLH-1758)', () => {
  it('nennt eine Antwort des eigenen Servers mit 408, 429 oder 5xx einen Serverfehler', () => {
    for (const status of [408, 429, 500, 503]) {
      expect(
        vormerkGrund(new ApiError(status, 'x', { vomAnwendungsserver: true })),
        String(status),
      ).toBe('serverfehler');
    }
  });

  it('nennt Netzfehler, Gateway ohne Umschlag und Sitzungsfälle offline', () => {
    expect(vormerkGrund(new NetzFehler())).toBe('offline');
    expect(vormerkGrund(new TypeError('Failed to fetch'))).toBe('offline');
    for (const status of [502, 503, 504]) {
      expect(vormerkGrund(new ApiError(status, 'Bad Gateway')), String(status)).toBe('offline');
    }
    for (const status of [401, 412]) {
      expect(
        vormerkGrund(new ApiError(status, 'x', { vomAnwendungsserver: true })),
        String(status),
      ).toBe('offline');
    }
  });
});
