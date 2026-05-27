import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den Einsatz-SSE-Stream und invalidiert bei jedem `person`- oder
 *  `lagged`-Event NUR die Personen-Listen-Query. Bewusst NICHT die Detail-Query:
 *  ein fremdes Schreiben soll keinen Detail-Refetch (und damit keinen Lese-Audit)
 *  auslösen. Der Stream trägt keine sensible Payload (nur einsatz_id + person_id).
 *
 *  Liegt hier neben `useEtbStream` als Bündel der SSE-Hooks — kein ETB-Bezug. */
export function usePersonenStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/personen/stream`);
    const resync = () => qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] });
    quelle.addEventListener('person', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('person', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
