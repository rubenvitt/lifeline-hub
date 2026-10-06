import { useCallback, useEffect, useRef, useState } from 'react';
import { OFFLINE_QUEUE_EVENT, queueZaehlerLaden, type OfflineQueueZaehler } from './queue';

const LEER: OfflineQueueZaehler = { ausstehend: 0, abgelehnt: 0, nicht_zugeordnet: 0 };

/**
 * Höchstens ein Ladevorgang je Fenster (LFH-939, design.md D5). Ein Abgleich meldet jede
 * Zeile einzeln; der Hook läuft dauerhaft mehrfach (Kopfleiste, Live-Banner, Wiederherstellung).
 * Gebündelt wird hier beim Verbraucher, nicht beim Melden: andere Hörer (der Abgleich selbst)
 * brauchen jedes Ereignis.
 */
export const ZAEHLER_DROSSEL_MS = 250;

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
    // Das erste Ereignis lädt sofort, weitere im Fenster danach ergeben genau einen
    // Ladevorgang an dessen Ende — der letzte Stand kommt also immer an.
    let uhr: ReturnType<typeof setTimeout> | null = null;
    let offen = false;
    const ausfuehren = () => {
      uhr = null;
      if (!offen) return;
      offen = false;
      laden();
      uhr = setTimeout(ausfuehren, ZAEHLER_DROSSEL_MS);
    };
    const anstossen = () => {
      offen = true;
      if (uhr === null) ausfuehren();
    };
    anstossen();
    window.addEventListener(OFFLINE_QUEUE_EVENT, anstossen);
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, anstossen);
      if (uhr !== null) clearTimeout(uhr);
      ladeGeneration.current += 1;
    };
  }, [laden]);
  return stand.scope === scope ? stand.wert : LEER;
}
