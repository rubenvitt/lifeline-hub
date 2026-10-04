import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthOptional } from '../auth/AuthContext';
import { ladeBenutzerEinstellungen, setzeBenutzerEinstellung } from '../api/benutzerEinstellungen';
import { globalKeys } from '../api/queryKeys';
import type { BenutzerEinstellungen } from '../api/types';
import {
  SCHLUESSEL_ETB_STANDARD_RUFNAME,
  leseStandardRufname,
  type StandardRufname,
} from './standardRufname';

export interface StandardRufnameZugriff {
  /** Der Standard der angemeldeten Person; `null` ohne Standard oder ohne Sitzung. */
  standard: StandardRufname | null;
  /**
   * Ob das Fach gelesen ist. Vorher fragt die Erfassung nicht nach dem Rufnamen: eine Abfrage,
   * die nach der Antwort wieder verschwindet, wäre ein Sprung unter dem Cursor.
   */
  geladen: boolean;
  /** Schreibt den Wert aus `standardRufnameWert`; lehnt bei einem Fehlschlag ab. */
  setze: (wert: string) => Promise<void>;
}

/**
 * Verdrahtet den Standard-Rufnamen (LFH-894) mit dem Präferenz-Fach der Person. Dasselbe Fach und
 * derselbe Key wie das Gedächtnis der Sprungpalette (`useZuletztBefehle`), deshalb dieselben
 * Riegel: Lesen nur angemeldet (ein 401 meldete „Sitzung abgelaufen“), kein Hintergrund-Refetch.
 *
 * Geschrieben wird NICHT optimistisch: die Pflicht hängt am Standard, ein Wert, den der Server
 * ablehnt, darf nicht als gesetzt dastehen. Aus der Antwort übernimmt der Cache nur DIESEN
 * Schlüssel — das Gedächtnis der Palette schreibt optimistisch in dasselbe Fach, eine späte
 * Vollantwort setzte es zurück.
 *
 * Das Fach steht in der Offline-Allowlist (`LAGEBILD_OFFLINE`): nach einem Kaltstart ohne Server
 * trägt der vorgehaltene Standard die Erfassung in die Queue.
 */
export function useStandardRufname(): StandardRufnameZugriff {
  const auth = useAuthOptional();
  const benutzerId = auth?.benutzer?.id ?? null;
  const client = useQueryClient();
  const key = useMemo(() => globalKeys.benutzerEinstellungenVon(benutzerId), [benutzerId]);

  const { data, isSuccess } = useQuery({
    queryKey: key,
    queryFn: ladeBenutzerEinstellungen,
    enabled: benutzerId != null,
    staleTime: Infinity,
  });

  const standard = useMemo(() => leseStandardRufname(data), [data]);

  const setze = useCallback(
    async (wert: string) => {
      const antwort = await setzeBenutzerEinstellung(SCHLUESSEL_ETB_STANDARD_RUFNAME, wert);
      const neu = antwort.eintraege?.[SCHLUESSEL_ETB_STANDARD_RUFNAME] ?? wert;
      client.setQueryData<BenutzerEinstellungen>(key, (alt) => ({
        ...alt,
        geaendert_at: antwort.geaendert_at ?? alt?.geaendert_at,
        eintraege: { ...alt?.eintraege, [SCHLUESSEL_ETB_STANDARD_RUFNAME]: neu },
      }));
    },
    [client, key],
  );

  return useMemo(() => ({ standard, geladen: isSuccess, setze }), [standard, isSuccess, setze]);
}
