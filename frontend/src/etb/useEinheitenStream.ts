import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { einsatzKeys } from '../api/queryKeys';

/** Abonniert den Einheiten-SSE-Stream und invalidiert bei jedem `einheit`-,
 *  `person`- oder `lagged`-Event die Einheiten- und Führungskräfte-Queries.
 *  `person`-Events werden mitbehandelt, da Führer-Zuordnungen das Leader-Set ändern. */
export function useEinheitenStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/einheiten/stream`);
    const resync = () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.fuehrungskraefte(einsatzId) });
    };
    quelle.addEventListener('einheit', resync);
    quelle.addEventListener('person', resync); // Führer-Zuordnung ändert Leader-Set
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('einheit', resync);
      quelle.removeEventListener('person', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
