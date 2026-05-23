import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den SSE-Stream eines Einsatzes. Bei jedem `etb`- oder `lagged`-Event
 *  wird die ETB-Query invalidiert → React Query holt die aktuell sichtbaren Seiten
 *  neu (respektiert Filter/Pagination). Das ist der vom Backend dokumentierte
 *  Resync-Weg (auch für `lagged`/Pufferüberlauf). */
export function useEtbStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/etb/stream`);
    const resync = () => qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
    quelle.addEventListener('etb', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('etb', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
