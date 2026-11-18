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
 * Öffnen: merkt sich, welche Abfragen unter den Org-Keys da schon Daten hatten. Beim Erst-Open
 * gleicht die zurückgegebene Funktion nur die Org-Keys ab, unter denen eine Abfrage einen Stand
 * von vor dem Verbindungsaufbau trägt, etwa aus der Zeit des vorigen Stroms (LFH-734). Auch ein
 * Neuabruf, der vor dem `open` fertig wurde, nimmt ihr das nicht: er kann vor dem Wechsel der
 * Ströme gelesen haben. Was erst mit dem Seitenaufruf zu laden begann, gilt als frisch; ein
 * Kaltaufruf lädt so nichts doppelt.
 *
 * Bewusst offen bleibt das kurze Fenster zwischen dem Lesen eines solchen Erstabrufs und der
 * Anmeldung des Stroms beim Server, wie bei den Einsatz-Abfragen, die beim Erst-Open gar nicht
 * abgleichen. Scheiterte vorher ein Versuch, ist das Fenster lang: dann gleicht der Aufrufer
 * alle Org-Keys ab (`beimErstenOpen(nachFehlversuch)`, `liveVerbindung.ts`).
 */
export function merkeOrgStand(qc: QueryClient): (sammler: LiveSammler) => void {
  const beginn = Date.now();
  const cache = qc.getQueryCache();
  const mitDaten = (query: Query) => query.state.dataUpdatedAt > 0;
  const vorher = new Set(
    ORG_LIVE_KEYS.flatMap((key) => cache.findAll({ queryKey: [key] }))
      .filter(mitDaten)
      .map((query) => query.queryHash),
  );
  // Danach aus dem Gerätespeicher Geladenes (`offline/lagebildSitzung.ts`) trägt seinen alten
  // Zeitpunkt. Einer aus derselben Millisekunde wie `beginn` heißt nicht sicher danach.
  const vorVerbindung = (query: Query) =>
    vorher.has(query.queryHash) || (mitDaten(query) && query.state.dataUpdatedAt <= beginn);
  return (sammler) =>
    ORG_LIVE_KEYS.forEach((key) => {
      if (cache.findAll({ queryKey: [key] }).some(vorVerbindung)) sammler.vormerken([key]);
    });
}
