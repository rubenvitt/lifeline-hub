import { describe, expect, it } from 'vitest';
import { listenTakt, statusTakt } from './aktualisierungTakt';
import type { AktualisierungsStatus, OfflineKarte } from '../api/offlineKarten';

const status = (karten: AktualisierungsStatus['karten']): AktualisierungsStatus => ({
  automatisch: true,
  intervall_stunden: 6,
  bau_dienst: 'nicht_konfiguriert',
  karten,
});

describe('Polling-Takt der Offline-Karten-Verwaltung (LFH-993)', () => {
  it('Status: 2 s, solange eine Phase läuft, sonst 60 s', () => {
    expect(statusTakt(undefined)).toBe(60_000);
    expect(statusTakt(status([]))).toBe(60_000);
    expect(statusTakt(status([{ karte_id: 1, fehler: 'x' }]))).toBe(60_000);
    expect(statusTakt(status([{ karte_id: 1, phase: 'baut' }]))).toBe(2_000);
  });

  it('Liste: 2 s bei laufendem Download oder Phase „laedt“, sonst aus', () => {
    const k = { status: 'bereit', geladen: null } as unknown as OfflineKarte;
    expect(listenTakt([k], undefined)).toBe(false);
    expect(listenTakt([{ ...k, status: 'laedt' }], undefined)).toBe(2_000);
    expect(listenTakt([{ ...k, geladen: 5 }], undefined)).toBe(2_000);
    expect(listenTakt([k], status([{ karte_id: 1, phase: 'baut' }]))).toBe(false);
    expect(listenTakt([k], status([{ karte_id: 1, phase: 'laedt' }]))).toBe(2_000);
  });
});
