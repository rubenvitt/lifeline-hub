import { QueryClientContext, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
import { ANTRAG_EREIGNIS } from '../../api/antragEreignis';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeAntraege } from '../../api/spiegelAntraege';
import type { SpiegelAntragAnzeige } from '../../api/types';

/**
 * Die eigenen Anträge am Spiegel (LLH-1492, design.md D13). Lädt nur an einem Spiegel (`aktiv`).
 * Nach jedem angenommenen Antrag (`ANTRAG_EREIGNIS` aus `apiSend`, auch beim Senden der
 * Warteschlange) gleicht sie Antragsliste und Einsatzkopf ab; die Zähler im Hinweisband stehen im
 * Kopf. Übernahmen und Ablehnungen kommen mit dem Abgleich, der `lagged` meldet.
 */
export function useSpiegelAntraege(einsatzId: number, aktiv: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!aktiv) return;
    const hoerer = (e: Event) => {
      if ((e as CustomEvent<{ einsatzId: number }>).detail?.einsatzId !== einsatzId) return;
      void qc.invalidateQueries({ queryKey: einsatzKeys.antraege(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId), exact: true });
    };
    window.addEventListener(ANTRAG_EREIGNIS, hoerer);
    return () => window.removeEventListener(ANTRAG_EREIGNIS, hoerer);
  }, [qc, einsatzId, aktiv]);
  return useQuery({
    queryKey: einsatzKeys.antraege(einsatzId),
    queryFn: () => ladeAntraege(einsatzId),
    enabled: aktiv,
  });
}

const KEINE: readonly SpiegelAntragAnzeige[] = [];

/**
 * Die geladenen Anträge aus dem Cache, ohne selbst zu laden: für Hooks, die auch ohne
 * `QueryClientProvider` laufen (`useVorgemerkteSchreibaktionen`). Geladen werden sie vom
 * Hinweisband im Einsatzrahmen, solange ein Spiegel offen ist. Ohne Daten eine leere Liste.
 */
export function useAntraegeAusCache(einsatzId: number): readonly SpiegelAntragAnzeige[] {
  const client = useContext(QueryClientContext);
  const abonnieren = useCallback(
    (melden: () => void) => (client ? client.getQueryCache().subscribe(melden) : () => {}),
    [client],
  );
  const lesen = useCallback(
    () => client?.getQueryData<SpiegelAntragAnzeige[]>(einsatzKeys.antraege(einsatzId)) ?? KEINE,
    [client, einsatzId],
  );
  return useSyncExternalStore(abonnieren, lesen, lesen);
}

/**
 * Ob der Einsatz ein Spiegel ist, und der Zeitpunkt des letzten Abrufs seines Kopfs, aus dem Cache
 * (LLH-1492). Am Spiegel meldet jede übernommene Lieferung `lagged`, und der Vollabgleich holt den
 * Kopf neu; das Band holt ihn zusätzlich im Takt. Ein geänderter `abgleichTakt` heißt: es kam ein
 * neuer Stand, ein Inhalt „wird geholt“ ist einen neuen Versuch wert. Ohne `QueryClientProvider`
 * kein Spiegel.
 */
export function useSpiegelAusCache(einsatzId: number | null): {
  spiegel: boolean;
  abgleichTakt: number;
} {
  const client = useContext(QueryClientContext);
  const abonnieren = useCallback(
    (melden: () => void) => (client ? client.getQueryCache().subscribe(melden) : () => {}),
    [client],
  );
  const lesenSpiegel = useCallback(() => {
    if (client == null || einsatzId == null) return false;
    const kopf = client.getQueryData<{ spiegel?: unknown }>(einsatzKeys.einsatz(einsatzId));
    return kopf?.spiegel != null;
  }, [client, einsatzId]);
  const lesenTakt = useCallback(
    () =>
      client == null || einsatzId == null
        ? 0
        : (client.getQueryState(einsatzKeys.einsatz(einsatzId))?.dataUpdatedAt ?? 0),
    [client, einsatzId],
  );
  const spiegel = useSyncExternalStore(abonnieren, lesenSpiegel, lesenSpiegel);
  const abgleichTakt = useSyncExternalStore(abonnieren, lesenTakt, lesenTakt);
  return { spiegel, abgleichTakt };
}
