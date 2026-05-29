import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den Schaden-SSE-Stream und invalidiert bei jedem `schaden`- oder
 *  `lagged`-Event die Schaden-Listen-Queries. Per Key-Prefix deckt das sowohl die
 *  Modul-Liste (`['einsatz-schaeden', einsatzId]`) als auch den
 *  „Als Geschädigte bei Schäden"-Block im Personen-Drawer ab. */
export function useSchaedenStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/schaeden/stream`);
    const resync = () => qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] });
    quelle.addEventListener('schaden', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('schaden', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
