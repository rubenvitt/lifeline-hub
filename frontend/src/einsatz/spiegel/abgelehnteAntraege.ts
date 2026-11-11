import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { useCallback, useContext, useSyncExternalStore } from 'react';
import { globalKeys } from '../../api/queryKeys';
import { loadAbgelehnteAntraege } from '../../api/spiegelAntraege';
import type { AbgelehnterAntragAnzeige } from '../../api/types';

/**
 * Abgelehnte Anträge nach der Verwahrung (LLH-1648). Nimmt der Hub einen Einsatz in Verwahrung,
 * ist er kein Spiegel mehr: das Hinweisband fehlt, und nach der Schonfrist liest ein Mitglied den
 * Einsatz nicht mehr. Die eigenen abgelehnten Anträge stehen deshalb einsatzübergreifend in der
 * Betriebszeile und im Wiederherstellungs-Drawer, bis ihre Frist abläuft.
 *
 * Geladen wird an EINER Stelle ({@link useAbgelehnteAntraegeLaden} in der Betriebszeile); Zeile und
 * Drawer lesen den Cache ({@link useAbgelehnteAntraegeAusCache}). Beides läuft auch ohne
 * `QueryClientProvider` (Tests der Betriebszeile): dann lädt nichts, und die Liste ist leer.
 */

const KEINE: readonly AbgelehnterAntragAnzeige[] = [];

/** Lädt die Liste (beim Anmelden, beim Fokus, nach dem Verwerfen); `aktiv` aus = nichts. */
export function useAbgelehnteAntraegeLaden(benutzerId: number | undefined, aktiv: boolean) {
  const client = useContext(QueryClientContext);
  const id = benutzerId ?? null;
  // Ohne Provider kein `useQuery`: die Komponente unten rendert dann nicht.
  return { laden: client != null && aktiv && id != null, id };
}

/** Der Abruf selbst; nur unter einem `QueryClientProvider` gerendert. */
export function AbgelehnteAntraegeQuelle({ benutzerId }: { benutzerId: number }) {
  useQuery({
    queryKey: globalKeys.abgelehnteAntraegeVon(benutzerId),
    queryFn: loadAbgelehnteAntraege,
  });
  return null;
}

/** Die geladenen Anträge aus dem Cache, ohne selbst zu laden; ohne Daten eine leere Liste. */
export function useAbgelehnteAntraegeAusCache(
  benutzerId: number | undefined,
): readonly AbgelehnterAntragAnzeige[] {
  const client = useContext(QueryClientContext);
  const id = benutzerId ?? null;
  const subscribe = useCallback(
    (notify: () => void) => (client ? client.getQueryCache().subscribe(notify) : () => {}),
    [client],
  );
  const read = useCallback(
    () =>
      id == null
        ? KEINE
        : (client?.getQueryData<AbgelehnterAntragAnzeige[]>(globalKeys.abgelehnteAntraegeVon(id)) ??
          KEINE),
    [client, id],
  );
  return useSyncExternalStore(subscribe, read, read);
}
