import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listeOffeneAuftraege } from '../api/auftraege';
import { einsatzKeys } from '../api/queryKeys';
import type { GeraetAnzeige } from '../api/types';

/** Dauer der Vibration in Millisekunden: kurz, ein Stoß. */
export const AUFTRAG_VIBRATION_MS = 200;

/**
 * Kennungen, die neu in der Liste stehen. `bekannt === null` ist der erste Stand nach dem Start:
 * dann gibt es nichts Neues, die offenen Aufträge waren schon da.
 */
export function neueAuftraege(
  bekannt: ReadonlySet<number> | null,
  aktuell: readonly { id: number }[],
): number[] {
  if (bekannt === null) return [];
  return aktuell.filter((a) => !bekannt.has(a.id)).map((a) => a.id);
}

/**
 * Kurze Vibration bei einem neuen Auftrag an die eigene Einheit (LLH-1579, F7; Spec
 * `benachrichtigungen`, „Gekoppelte Geräte bleiben still“). Nur das Einheitengerät; kein Ton, kein
 * Toast. Die Liste ist dieselbe Abfrage wie auf der Seite „Aufträge“ (gleicher Key, ein Abruf),
 * der Server schneidet sie auf die eigene Einheit zu, der Einsatzstrom frischt sie auf. Was beim
 * Start schon offen ist, vibriert nicht; ein Gerät ohne Vibration (Desktop, iOS) bleibt still.
 */
export function useAuftragsVibration(geraet: GeraetAnzeige | null): void {
  const eid = geraet?.einsatz_id ?? 0;
  const aktiv = geraet?.ansicht === 'einheit';
  const { data } = useQuery({
    queryKey: einsatzKeys.auftraegePhase(eid, 'offen', 'alle', 'alle'),
    queryFn: () => listeOffeneAuftraege(eid),
    enabled: aktiv,
  });
  const bekannt = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!aktiv || !data) return;
    const neu = neueAuftraege(bekannt.current, data);
    bekannt.current = new Set([...(bekannt.current ?? []), ...data.map((a) => a.id)]);
    if (neu.length > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(AUFTRAG_VIBRATION_MS);
    }
  }, [aktiv, data]);
}
