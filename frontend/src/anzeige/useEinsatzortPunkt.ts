import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { LatLon } from './koordinaten';

/**
 * Koordinate des Einsatzorts, wenn verortet — die Umgebung, an der „Auf Karte wählen“ eines
 * Ortsfelds im Einsatz beginnt (LLH-1121, Spec `ortsfeld`, „Auf Karte wählen“). Liest denselben
 * Cache wie der Einsatzkopf (`einsatzKeys.einsatz`), fragt also meist nicht neu.
 */
export function useEinsatzortPunkt(einsatzId: number): LatLon | null {
  const { data } = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  return data?.einsatzort_lat != null && data.einsatzort_lon != null
    ? { lat: data.einsatzort_lat, lon: data.einsatzort_lon }
    : null;
}
