import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den Abschnitte-SSE-Stream und invalidiert bei jedem `abschnitt`-,
 *  `person`- oder `lagged`-Event die Abschnitte- und Führungskräfte-Queries.
 *  `person`-Events werden mitbehandelt, da leiter_id-Änderungen das Leader-Set berühren. */
export function useAbschnitteStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/abschnitte/stream`);
    const resync = () => {
      qc.invalidateQueries({ queryKey: ['einsatz-abschnitte', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-fuehrungskraefte', einsatzId] });
    };
    quelle.addEventListener('abschnitt', resync);
    quelle.addEventListener('person', resync); // leiter_id-Änderung berührt Leader-Set
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('abschnitt', resync);
      quelle.removeEventListener('person', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
