import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OFFLINE_QUEUE_EVENT, queueZaehlerLaden, type OfflineQueueZaehler } from './queue';
import { loadStoredQueueZaehler, saveQueueZaehler } from './queueZaehlerMerker';

const LEER: OfflineQueueZaehler = { ausstehend: 0, abgelehnt: 0, nicht_zugeordnet: 0 };

/**
 * Höchstens ein Ladevorgang je Fenster (LFH-939, design.md D5). Ein Abgleich meldet jede
 * Zeile einzeln; der Hook läuft dauerhaft mehrfach (Kopfleiste, Live-Banner, Wiederherstellung).
 * Gebündelt wird hier beim Verbraucher, nicht beim Melden: andere Hörer (der Abgleich selbst)
 * brauchen jedes Ereignis.
 */
export const ZAEHLER_DROSSEL_MS = 250;

/**
 * Reaktive Sicht auf die persistenten Queue-Zähler.
 *
 * VOR DEM ERSTEN BILD (LLH-1910, Spec `kopfleiste`): Über alle Einsätze (so rufen Kopfleiste und
 * Betriebszeile) beginnt der Hook mit dem zuletzt gelesenen Stand der Person
 * (`queueZaehlerMerker.ts`), bis die Queue antwortet, und merkt jeden gelesenen Stand. Im Scope
 * eines Einsatzes beginnt er leer.
 */
export function useOfflineQueueZaehler(
  benutzerId: number | undefined,
  einsatzId?: number,
): OfflineQueueZaehler {
  const scope = `${benutzerId ?? 'anonym'}:${einsatzId ?? 'alle'}`;
  const isMerkerScope = benutzerId != null && einsatzId == null;
  const startwert = useMemo(
    () => (isMerkerScope ? (loadStoredQueueZaehler(benutzerId) ?? LEER) : LEER),
    [isMerkerScope, benutzerId],
  );
  const [stand, setStand] = useState<{ scope: string; wert: OfflineQueueZaehler }>({
    scope,
    wert: startwert,
  });
  const loadGeneration = useRef(0);
  const load = useCallback(() => {
    const generation = ++loadGeneration.current;
    if (benutzerId == null) {
      setStand({ scope, wert: LEER });
      return;
    }
    void queueZaehlerLaden(benutzerId, einsatzId).then((wert) => {
      if (loadGeneration.current !== generation) return;
      if (einsatzId == null) saveQueueZaehler(benutzerId, wert);
      setStand({ scope, wert });
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
      load();
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
      loadGeneration.current += 1;
    };
  }, [load]);
  return stand.scope === scope ? stand.wert : startwert;
}
