import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den UHS-Kanal und invalidiert UHS-Liste (jedes `uhs`-Event) +
 *  Personen-Liste (jedes `person`-Event — Cache-Felder ändern sich). Trägt KEINE
 *  sensible Payload — Clients refetchen. */
export function useUhsStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/uhs/stream`);
    const resyncUhs = () => qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
    const resyncPersonen = () => qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] });
    const onLag = () => { resyncUhs(); resyncPersonen(); };
    quelle.addEventListener('uhs', resyncUhs);
    quelle.addEventListener('person', resyncPersonen);
    quelle.addEventListener('lagged', onLag);
    return () => {
      quelle.removeEventListener('uhs', resyncUhs);
      quelle.removeEventListener('person', resyncPersonen);
      quelle.removeEventListener('lagged', onLag);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
