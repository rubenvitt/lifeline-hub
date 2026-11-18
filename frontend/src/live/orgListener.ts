import type { Query, QueryClient } from '@tanstack/react-query';
import { ORG_LIVE_KEYS, ORG_STREAM_EVENTS } from '../api/queryKeys';
import type { LiveSammler } from './liveInvalidierung';

/**
 * Listener der Org-Ereignisse (LFH-734), abgeleitet aus {@link ORG_STREAM_EVENTS}. Beide
 * Ströme hängen sie an: der Einsatz-Strom trägt die Org-Ereignisse mit, außerhalb eines
 * Einsatzes der Org-Strom `/api/live`. Vorgemerkt wird der einstellige Prefix `[key]`, er trifft
 * auch die Filter-Fächer (`personalListe('alle')`); abgeglichen gebündelt über den Sammler der
 * Verbindung (LFH-922).
 */
export function orgListener(sammler: LiveSammler): [string, EventListener][] {
  return Object.entries(ORG_STREAM_EVENTS).map(([event, keys]) => [
    event,
    () => keys.forEach((key) => sammler.vormerken([key])),
  ]);
}

/** Vollabgleich der live geführten globalen Keys: nach `lagged` und jedem Wiederaufbau. */
export function invalidiereOrgLiveKeys(sammler: LiveSammler): void {
  ORG_LIVE_KEYS.forEach((key) => sammler.vormerken([key]));
}

/**
 * Abgleich für das erste `open` einer neuen Verbindung (LLH-1839). Aufrufen unmittelbar vor dem
 * Öffnen: merkt sich den Zeitpunkt. Beim Erst-Open gleicht die zurückgegebene Funktion nur die
 * Org-Keys ab, unter denen eine Abfrage schon vorher Daten im Cache hatte, etwa aus der Zeit des
 * vorigen Stroms (LFH-734). Was erst mit dem Seitenaufruf zu laden begann, gilt als frisch; ein
 * Kaltaufruf lädt so nichts doppelt.
 *
 * Bewusst offen bleibt das kurze Fenster zwischen dem Lesen eines solchen Erstabrufs und der
 * Anmeldung des Stroms beim Server, wie bei den Einsatz-Abfragen, die beim Erst-Open gar nicht
 * abgleichen.
 */
export function merkeOrgStand(qc: QueryClient): (sammler: LiveSammler) => void {
  const beginn = Date.now();
  const cache = qc.getQueryCache();
  // Ein Stand aus derselben Millisekunde wie `beginn` heißt nicht sicher danach: im Zweifel
  // abgleichen. Lädt die Abfrage gerade neu, wartet der Sammler den Abruf ab und holt danach.
  const vorVerbindung = (query: Query) =>
    query.state.dataUpdatedAt > 0 && query.state.dataUpdatedAt <= beginn;
  return (sammler) =>
    ORG_LIVE_KEYS.forEach((key) => {
      if (cache.findAll({ queryKey: [key] }).some(vorVerbindung)) sammler.vormerken([key]);
    });
}
