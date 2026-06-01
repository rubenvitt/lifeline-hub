import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den Zonen-SSE-Kanal und invalidiert die Zonen-Query bei Änderungen. */
export function useZonenStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/zonen/stream`);
    const resync = () => {
      qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] });
    };
    quelle.addEventListener('lage_zone', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('lage_zone', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
