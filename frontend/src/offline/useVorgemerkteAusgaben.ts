import { useCallback, useEffect, useRef, useState } from 'react';
import {
  beobachteQueueAenderungen,
  schreibaktionenLaden,
  type AusstehendeSchreibaktion,
  type OfflineSchreibaktion,
} from './queue';

/** Eine auf diesem Gerät vorgemerkte, vom Server noch nicht bestätigte Verpflegungsausgabe. */
export type VorgemerkteAusgabe = AusstehendeSchreibaktion & {
  aktion: Extract<OfflineSchreibaktion, { art: 'ausgabe' }>;
};

const LEER: VorgemerkteAusgabe[] = [];

function istAusgabe(z: AusstehendeSchreibaktion): z is VorgemerkteAusgabe {
  return z.aktion.art === 'ausgabe';
}

/**
 * Reaktive Sicht auf die vorgemerkten Ausgaben eines Einsatzes (LFH-688, design.md D8). Nur der
 * Store der ausstehenden Schreibaktionen: abgelehnte gehören in den Wiederherstellungs-Drawer,
 * nicht als „ausstehend“ an die Karte. Muster wie `useOfflineQueueZaehler`, aber auch über Tabs
 * hinweg: flusht ein anderer Tab, entfällt „ausstehend“ hier ebenfalls (`beobachteQueueAenderungen`).
 */
export function useVorgemerkteAusgaben(
  benutzerId: number | undefined,
  einsatzId: number,
): VorgemerkteAusgabe[] {
  const scope = `${benutzerId ?? 'anonym'}:${einsatzId}`;
  const [stand, setStand] = useState<{ scope: string; wert: VorgemerkteAusgabe[] }>({
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
    void schreibaktionenLaden(benutzerId, einsatzId).then((zeilen) => {
      if (ladeGeneration.current === generation) {
        setStand({ scope, wert: zeilen.filter(istAusgabe) });
      }
    });
  }, [benutzerId, einsatzId, scope]);

  useEffect(() => {
    laden();
    const beenden = beobachteQueueAenderungen(laden);
    return () => {
      beenden();
      ladeGeneration.current += 1;
    };
  }, [laden]);
  return stand.scope === scope ? stand.wert : LEER;
}
