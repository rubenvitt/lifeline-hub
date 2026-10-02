import type { AktualisierungsStatus, OfflineKarte } from '../api/offlineKarten';

/**
 * Polling-Takt der Offline-Karten-Verwaltung (LFH-993, design.md D9). Status-Push gibt es nicht;
 * die Verwaltung fragt nach, solange sich etwas bewegt, und sonst selten.
 */

/** Status der Automatik: alle 2 s, solange eine Karte eine Phase trägt, sonst jede Minute. */
export function statusTakt(status: AktualisierungsStatus | undefined): number {
  return status?.karten.some((k) => k.phase != null) ? 2_000 : 60_000;
}

/**
 * Liste: alle 2 s, solange eine Zeile lädt (neue Zeile `laedt` oder In-Place-Fortschritt) ODER
 * der Status für eine Karte „lädt“ meldet — ein vom Wächter gestarteter Download soll seinen
 * Fortschritt zeigen, obwohl ihn kein Klick ausgelöst hat. Sonst aus.
 */
export function listenTakt(
  karten: OfflineKarte[] | undefined,
  status: AktualisierungsStatus | undefined,
): number | false {
  const laeuft = karten?.some((k) => k.status === 'laedt' || k.geladen != null) ?? false;
  const wachterLaedt = status?.karten.some((k) => k.phase === 'laedt') ?? false;
  return laeuft || wachterLaedt ? 2_000 : false;
}
