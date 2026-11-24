import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ladeModulFreigaben } from '../api/einsaetze';
import { fetchLagebesprechungStand } from '../api/lagebesprechung';
import { einsatzKeys } from '../api/queryKeys';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';

/**
 * Die letzte abgehaltene Lagebesprechung für die Schnellwahl „Seit letzter Lagebesprechung“
 * (`anzeige/ZeitraumWahl.tsx`, LLH-1080; ETB und Lagemeldungen, LLH-1322).
 *
 * Gate ist die Freigabe `lagebesprechung` (LLH-1111), nicht der Stab: ohne sie geht keine Anfrage,
 * und ohne abgehaltene Besprechung ist `von` `null` — die Wahl wird dann nicht angeboten. Dieselben
 * Keys wie die Modulseite, die Abfragen teilen sich den Cache.
 *
 * `von` liegt auf der vollen Minute wie jede Wahl der Schnellwahl (Spec `etb-filterleiste`): „seit
 * LB 1330“ schließt einen Eintrag um 13:30:10 ein, auch wenn die Besprechung um 13:30:42 endete.
 */
export function useLetzteLagebesprechung(einsatzId: number) {
  const modulFreigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const frei = istKeyFreigegeben('lagebesprechung', modulFreigabenQuery.data);
  const lagebesprechungQuery = useQuery({
    queryKey: einsatzKeys.lagebesprechung(einsatzId),
    queryFn: () => fetchLagebesprechungStand(einsatzId),
    enabled: frei,
  });
  const stand = frei ? (lagebesprechungQuery.data?.letzte_lagebesprechung ?? null) : null;
  const von = useMemo(() => {
    const z = alsZeitpunkt(stand?.abgehalten_at);
    return z ? alsBackendZeit(z.utc().startOf('minute')) : null;
  }, [stand?.abgehalten_at]);
  return { stand, von };
}
