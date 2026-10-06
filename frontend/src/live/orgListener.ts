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
