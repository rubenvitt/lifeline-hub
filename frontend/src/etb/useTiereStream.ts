import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den Einsatz-SSE-Stream und invalidiert bei jedem `tier`- oder
 *  `lagged`-Event die Tier-Listen-Queries (`['einsatz-tiere', einsatzId, …]`).
 *  Per Prefix-Match deckt das sowohl die Modul-Liste als auch den
 *  „Zugeordnete Tiere"-Block im Personen-Drawer ab. Keine sensible Payload
 *  (nur einsatz_id + tier_id). Liegt neben den übrigen SSE-Hooks. */
export function useTiereStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/tiere/stream`);
    const resync = () => qc.invalidateQueries({ queryKey: ['einsatz-tiere', einsatzId] });
    quelle.addEventListener('tier', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('tier', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
