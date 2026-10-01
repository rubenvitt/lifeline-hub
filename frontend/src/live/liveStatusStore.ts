/**
 * Der Live-Verbindungszustand als EINE Lesequelle für alle Anzeigen (Betriebszeile,
 * Instrumentenband), damit sie nicht auseinanderlaufen.
 *
 * Ein Store statt eines Listeners je Anzeige, weil `lfh:live-status` ein Broadcast OHNE
 * Replay ist: wer nach dem Abriss mountet, sähe nie ein Ereignis und bliebe auf `idle`.
 * Gemeldet wird über das window-Ereignis aus `liveVerbindung.ts` (`oeffneLiveVerbindung`), für
 * den Einsatz- wie für den Org-Strom (LFH-734); der Store ist nur die Leseseite davor (Vertrag `useSyncExternalStore` wie `pwa/appAktualisierung`).
 */
import type { LiveVerbindungsStatus } from './liveVerbindung';

let stand: LiveVerbindungsStatus = 'idle';
const horcher = new Set<() => void>();

// Der Fensterlauscher hängt EINMAL am Modul, nicht je Abonnent: mit Abo-Zähler verlöre der
// Store zwischen zwei Abonnenten genau die Ereignisse, für deren Aufbewahrung er existiert.
if (typeof window !== 'undefined') {
  window.addEventListener('lfh:live-status', (e: Event) => {
    const gemeldet = (e as CustomEvent<{ status?: LiveVerbindungsStatus }>).detail?.status;
    if (!gemeldet || gemeldet === stand) return;
    stand = gemeldet;
    horcher.forEach((h) => h());
  });
}

/** Abonniert Änderungen; gibt die Abmeldung zurück (Vertrag `useSyncExternalStore`). */
export function abonniereLiveStatus(aufAenderung: () => void): () => void {
  horcher.add(aufAenderung);
  return () => horcher.delete(aufAenderung);
}

/** Der zuletzt gemeldete Zustand. Primitiv, also referenzstabil (Vertrag `getSnapshot`). */
export function leseLiveStatus(): LiveVerbindungsStatus {
  return stand;
}

/** Nur für Tests — der Modulzustand überlebt sonst zwischen zwei `it`-Blöcken. */
export function setzeLiveStatusFuerTest(status: LiveVerbindungsStatus): void {
  stand = status;
  horcher.forEach((h) => h());
}
