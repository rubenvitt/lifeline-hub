import { queryOptions } from '@tanstack/react-query';
import { ladePerson } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';

/**
 * Abruf des Personen-Details für jeden Beobachter von `einsatzKeys.person` (Detailseite, Drawer,
 * Vorschau der Sprungpalette, Nachforderungen). Der GET schreibt serverseitig je Abruf eine Zeile
 * ins Zugriffsprotokoll (`person_zugriff_audit`). Ein Neuladen beim Fensterwechsel oder ein
 * automatischer Retry erzeugte Zugriffe, die niemand getan hat (LLH-1832, LLH-1984). Weil schon
 * ein einziger Beobachter mit Fokus-Neuladen den Abruf auslöst, nimmt jeder diese Vorgaben.
 * Aufrufer dürfen `enabled`, `staleTime` und `refetchOnReconnect` setzen, nie diese zwei.
 */
export function personDetailQueryOptions(einsatzId: number, personId: number | null) {
  return queryOptions({
    queryKey: einsatzKeys.person(einsatzId, personId),
    queryFn: () => ladePerson(einsatzId, personId as number),
    enabled: personId != null,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
