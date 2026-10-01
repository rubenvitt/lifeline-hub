import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { beobachteEinsatzStrom, einsatzStromOffen } from './einsatzStromStore';
import { oeffneLiveVerbindung } from './liveVerbindung';
import { invalidiereOrgLiveKeys, orgListener } from './orgListener';

/**
 * Org-Strom `GET /api/live` (LFH-734): hält Einsatzliste und Stammdaten-Kataloge außerhalb eines
 * Einsatzes frisch. Gehostet in der Betriebszeile (`App.tsx`, `BetriebsLayout`), also auf jeder
 * angemeldeten Route.
 *
 * Offen nur, wenn angemeldet UND kein Einsatz-Strom offen ist: im Einsatz trägt dessen Strom die
 * Org-Ereignisse mit, und ein Tab bleibt bei EINER SSE-Verbindung (HTTP/1.1-Grenze,
 * `useEinsatzLiveStream.ts`). Schon das erste `open` gleicht die Org-Keys ab, denn beim Wechsel
 * aus dem Einsatz-Strom kann ein Ereignis zwischen beiden Verbindungen verloren gehen.
 */
export function useOrgLiveStream(angemeldet: boolean): void {
  const qc = useQueryClient();
  const imEinsatz = useSyncExternalStore(beobachteEinsatzStrom, einsatzStromOffen);
  const aktiv = angemeldet && !imEinsatz;

  useEffect(() => {
    if (!aktiv) return;
    const abgleich = () => invalidiereOrgLiveKeys(qc);
    return oeffneLiveVerbindung({
      url: '/api/live',
      listeners: [...orgListener(qc), ['lagged', abgleich]],
      beiWiederaufbau: abgleich,
      auchBeimErstenOpen: true,
    });
  }, [aktiv, qc]);
}
