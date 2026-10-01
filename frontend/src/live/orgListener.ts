import type { QueryClient } from '@tanstack/react-query';
import { ORG_LIVE_KEYS, ORG_STREAM_EVENTS } from '../api/queryKeys';

/**
 * Listener der Org-Ereignisse (LFH-734), abgeleitet aus {@link ORG_STREAM_EVENTS}. Beide
 * Ströme hängen sie an: der Einsatz-Strom trägt die Org-Ereignisse mit, außerhalb eines
 * Einsatzes der Org-Strom `/api/live`. Invalidiert wird der einstellige Prefix `[key]`, er trifft
 * auch die Filter-Fächer (`personalListe('alle')`).
 */
export function orgListener(qc: QueryClient): [string, EventListener][] {
  return Object.entries(ORG_STREAM_EVENTS).map(([event, keys]) => [
    event,
    () => keys.forEach((key) => void qc.invalidateQueries({ queryKey: [key] })),
  ]);
}

/** Vollabgleich der live geführten globalen Keys: nach `lagged` und jedem Wiederaufbau. */
export function invalidiereOrgLiveKeys(qc: QueryClient): void {
  ORG_LIVE_KEYS.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }));
}
