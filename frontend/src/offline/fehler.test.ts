import { describe, expect, it } from 'vitest';
import { ApiError, NetzFehler } from '../api/client';
import { istOfflineTransient } from './fehler';

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
