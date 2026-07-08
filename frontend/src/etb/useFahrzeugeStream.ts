import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { einsatzKeys } from '../api/queryKeys';

/** Abonniert den Fahrzeuge-SSE-Stream und invalidiert bei jedem `fahrzeug`-
 *  oder `lagged`-Event die Fahrzeuge-Query. */
export function useFahrzeugeStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/fahrzeuge/stream`);
    const resync = () => qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    quelle.addEventListener('fahrzeug', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('fahrzeug', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
