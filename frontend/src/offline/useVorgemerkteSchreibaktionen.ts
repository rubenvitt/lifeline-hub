import { useCallback, useEffect, useRef, useState } from 'react';
import {
  beobachteQueueAenderungen,
  schreibaktionenLaden,
  type AusstehendeSchreibaktion,
  type OfflineSchreibaktion,
} from './queue';

type Art = OfflineSchreibaktion['art'];

/** Eine auf diesem Gerät vorgemerkte, vom Server noch nicht bestätigte Schreibaktion einer Art. */
export type VorgemerkteSchreibaktion<A extends Art> = AusstehendeSchreibaktion & {
  aktion: Extract<OfflineSchreibaktion, { art: A }>;
};

/** Ein vorgemerktes Eintreffen am Bereitstellungsraum (LLH-1075 Teil III). */
export type VorgemerktesEintreffen = VorgemerkteSchreibaktion<'eintreffen'>;

const LEER: never[] = [];

/**
 * Reaktive Sicht auf die vorgemerkten Schreibaktionen einer Art in einem Einsatz (LFH-688,
 * design.md D8; verallgemeinert für LLH-1075 Teil III). Nur der Store der ausstehenden
 * Schreibaktionen: abgelehnte gehören in den Wiederherstellungsbereich, nicht als „ausstehend“ an
 * die Fachseite. Folgt der Queue auch über Tabs hinweg: flusht ein anderer Tab, entfällt
 * „ausstehend“ hier ebenfalls (`beobachteQueueAenderungen`).
 */
export function useVorgemerkteSchreibaktionen<A extends Art>(
  benutzerId: number | undefined,
  einsatzId: number,
  art: A,
): VorgemerkteSchreibaktion<A>[] {
  const scope = `${benutzerId ?? 'anonym'}:${einsatzId}:${art}`;
  const [stand, setStand] = useState<{ scope: string; wert: VorgemerkteSchreibaktion<A>[] }>({
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
        setStand({
          scope,
          wert: zeilen.filter((z): z is VorgemerkteSchreibaktion<A> => z.aktion.art === art),
        });
      }
    });
  }, [benutzerId, einsatzId, art, scope]);

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

/** Vorgemerkte Eintreffen eines Einsatzes, über alle Räume (LLH-1075 Teil III). */
export function useVorgemerkteEintreffen(
  benutzerId: number | undefined,
  einsatzId: number,
): VorgemerktesEintreffen[] {
  return useVorgemerkteSchreibaktionen(benutzerId, einsatzId, 'eintreffen');
}
