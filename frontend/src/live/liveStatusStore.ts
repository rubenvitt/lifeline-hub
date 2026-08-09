/**
 * Der Live-Verbindungszustand als EINE Lesequelle (LFH-336 · Befund M3).
 *
 * Vorher hielt jede Anzeige ihre eigene Kopie: die Betriebszeile lauschte selbst
 * auf `lfh:live-status`, das Instrumentenband des Lage-Dashboards leitete den
 * Zustand aus QUERY-Fehlern ab. Ergebnis — bei abgerissenem SSE meldete das Band
 * „Live verbunden", während der Banner „Verbindung unterbrochen" zeigte. Zwei
 * Anzeigen für denselben Sachverhalt, die auseinanderlaufen.
 *
 * Warum ein Store und nicht ein zweiter `useEffect`-Listener: `lfh:live-status`
 * ist ein Broadcast OHNE Replay. Wer nach dem Abriss mountet, sieht nie ein
 * Ereignis und bliebe auf `idle` — also auf „alles in Ordnung". Der Store hält
 * den letzten Stand und gibt ihn jedem neuen Leser sofort.
 *
 * `useEinsatzLiveStream` bleibt unangetastet: das window-Ereignis bleibt die
 * Wire-Schnittstelle (der Hook bleibt render-state-frei und behält EINE
 * EventSource), der Store ist nur die gemeinsame LESESEITE davor.
 *
 * Bauform nach dem Vorbild von `pwa/appAktualisierung` — derselbe
 * `useSyncExternalStore`-Vertrag, den `LiveStatusBanner` für die App-Version
 * bereits konsumiert.
 */
import type { LiveVerbindungsStatus } from './useEinsatzLiveStream';

let stand: LiveVerbindungsStatus = 'idle';
const horcher = new Set<() => void>();

// Der Fensterlauscher hängt EINMAL am Modul, nicht je Abonnent. Ein Abo-Zähler
// mit add/removeEventListener wäre die sparsamere Variante — aber dann verlöre
// der Store zwischen zwei Abonnenten genau die Ereignisse, für deren Aufbewahrung
// er existiert.
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

/** Der zuletzt gemeldete Verbindungszustand. Primitiv, also referenzstabil —
 *  `useSyncExternalStore` verlangt das von `getSnapshot`. */
export function leseLiveStatus(): LiveVerbindungsStatus {
  return stand;
}

/** Setzt den Stand zurück. Nur für Tests — der Modulzustand überlebt sonst
 *  zwischen zwei `it`-Blöcken derselben Datei. */
export function setzeLiveStatusFuerTest(status: LiveVerbindungsStatus): void {
  stand = status;
  horcher.forEach((h) => h());
}
