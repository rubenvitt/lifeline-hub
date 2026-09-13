import { useCallback, useEffect, useRef, useState } from 'react';
import { OFFLINE_QUEUE_EVENT, queueZaehlerLaden, type OfflineQueueZaehler } from './queue';

const LEER: OfflineQueueZaehler = { ausstehend: 0, abgelehnt: 0, nicht_zugeordnet: 0 };

/** Reaktive Sicht auf die persistenten Queue-Zähler. */
export function useOfflineQueueZaehler(
  benutzerId: number | undefined,
  einsatzId?: number,
): OfflineQueueZaehler {
  const scope = `${benutzerId ?? 'anonym'}:${einsatzId ?? 'alle'}`;
  const [stand, setStand] = useState<{ scope: string; wert: OfflineQueueZaehler }>({
    scope,
    wert: LEER,
  });
  const ladeGeneration = useRef(0);
  const laden = useCallback(() => {
    const generation = ++ladeGeneration.current;
    if (benutzerId == null) {
      setStand({ scope, wert: LEER });
      return;
    }
    void queueZaehlerLaden(benutzerId, einsatzId).then((wert) => {
      if (ladeGeneration.current === generation) setStand({ scope, wert });
    });
  }, [benutzerId, einsatzId, scope]);

  useEffect(() => {
    laden();
    window.addEventListener(OFFLINE_QUEUE_EVENT, laden);
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, laden);
      ladeGeneration.current += 1;
    };
  }, [laden]);
  return stand.scope === scope ? stand.wert : LEER;
}
