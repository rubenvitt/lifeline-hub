import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useAuthOptional } from '../auth/AuthContext';
import { ladeBenutzerEinstellungen, setzeBenutzerEinstellung } from '../api/benutzerEinstellungen';
import { globalKeys } from '../api/queryKeys';
import type { BenutzerEinstellungen } from '../api/types';
import { alsBackendZeit } from '../anzeige/zeitEingabe';

/**
 * Stand des Benutzer-Einstellungsfachs und ein Merker für Hinweise, die nur einmal erscheinen
 * (Willkommenskarte LLH-1824, Rundgang LLH-1990). Ein gekoppeltes Gerät hat kein Fach (LFH-892).
 */
export function useEinstellungMerken(): {
  stand: BenutzerEinstellungen | undefined;
  benutzerId: number | null;
  /** Steht fest, ob ein Stand kommt: mit Stand, ohne Person oder nach dem ersten Fehlversuch. */
  entschieden: boolean;
  merke: (schluessel: string) => void;
} {
  const auth = useAuthOptional();
  const benutzerId = auth?.geraet ? null : ((auth?.benutzer as { id?: number } | null)?.id ?? null);
  const client = useQueryClient();
  const key = useMemo(() => globalKeys.benutzerEinstellungenVon(benutzerId), [benutzerId]);
  const { data, errorUpdateCount, failureCount } = useQuery({
    queryKey: key,
    queryFn: ladeBenutzerEinstellungen,
    enabled: benutzerId != null,
    staleTime: Infinity,
  });

  const merke = useCallback(
    (schluessel: string) => {
      // Sofort im Cache und nur den eigenen Schlüssel im geteilten Fach ergänzen, nie den ganzen
      // Stand ersetzen: sonst überschriebe die späte Antwort, was `useZuletztBefehle` inzwischen
      // gemerkt hat. Ein Fehler kostet höchstens ein erneutes Erscheinen in einer späteren Sitzung.
      const wert = alsBackendZeit(dayjs());
      client.setQueryData<BenutzerEinstellungen>(key, (alt) =>
        alt ? { ...alt, eintraege: { ...alt.eintraege, [schluessel]: wert } } : alt,
      );
      setzeBenutzerEinstellung(schluessel, wert).catch(() => {});
    },
    [client, key],
  );

  // `errorUpdateCount`, nicht `isError`: wer dasselbe Fach später abonniert, ruft einen
  // gescheiterten Stand neu ab; mit `isError` fiele `entschieden` dann wieder auf `false`.
  const entschieden =
    benutzerId == null || data !== undefined || errorUpdateCount > 0 || failureCount > 0;

  return { stand: benutzerId == null ? undefined : data, benutzerId, entschieden, merke };
}
