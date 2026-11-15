import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthOptional } from '../auth/AuthContext';
import { ladeBenutzerEinstellungen, setzeBenutzerEinstellung } from '../api/benutzerEinstellungen';
import { globalKeys } from '../api/queryKeys';
import { SCHNELLAKTION_IDS } from './befehle';
import {
  SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER,
  leseZaehler,
  naechsterZaehler,
  type Zaehlung,
} from './schnellaktionZaehler';
import type { BenutzerEinstellungen } from '../api/types';

export interface SchnellaktionZaehlung {
  /** Ausführungen je Befehls-Id einer Schnellaktion. Identitätsstabil, solange sich der Stand nicht ändert. */
  zaehlung: Zaehlung;
  /** Meldet eine Ausführung. Nach dem Unmount des Aufrufers weiterhin gültig (wie `useZuletztBefehle`). */
  zaehle: (id: string) => void;
}

/**
 * Verdrahtet den Server-Slot `schnellaktionen_zaehler` mit dem reinen Kern aus
 * `schnellaktionZaehler.ts` (y3zh5ymv D5). Dasselbe Muster und dieselben Gründe wie
 * `useZuletztBefehle`: im Provider montiert, Schreibweg über den `QueryClient` (die Palette ist beim
 * Schreiben schon abgehängt), erst den Bestand kennen, dann schreiben (das PUT ist Vollersatz),
 * die Antwort verwerfen, ein Fehlschlag kostet nur eine Zählung. Beide Hooks teilen das Fach
 * `benutzerEinstellungenVon`; jeder schreibt nur seinen Schlüssel.
 */
export function useSchnellaktionZaehler(): SchnellaktionZaehlung {
  const auth = useAuthOptional();
  // Ein gekoppeltes Gerät hat keine Palette (LFH-892).
  const benutzerId = auth?.geraet ? null : (auth?.benutzer?.id ?? null);
  const client = useQueryClient();
  const key = useMemo(() => globalKeys.benutzerEinstellungenVon(benutzerId), [benutzerId]);

  const { data } = useQuery({
    queryKey: key,
    queryFn: ladeBenutzerEinstellungen,
    enabled: benutzerId != null,
    staleTime: Infinity,
  });

  const zaehlung = useMemo(() => leseZaehler(data), [data]);

  const zaehle = useCallback(
    (id: string) => {
      if (benutzerId == null || !SCHNELLAKTION_IDS.includes(id)) return;
      void (async () => {
        if (client.getQueryData<BenutzerEinstellungen>(key) === undefined) {
          try {
            await client.ensureQueryData({
              queryKey: key,
              queryFn: ladeBenutzerEinstellungen,
              staleTime: Infinity,
            });
          } catch {
            return;
          }
        }
        const stand = client.getQueryData<BenutzerEinstellungen>(key);
        if (stand === undefined) return;
        const wert = JSON.stringify(naechsterZaehler(leseZaehler(stand), id, SCHNELLAKTION_IDS));
        client.setQueryData<BenutzerEinstellungen>(key, (alt) => ({
          ...alt,
          eintraege: { ...alt?.eintraege, [SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER]: wert },
        }));
        void setzeBenutzerEinstellung(SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER, wert).catch(() => {});
      })();
    },
    [benutzerId, client, key],
  );

  return useMemo(() => ({ zaehlung, zaehle }), [zaehlung, zaehle]);
}
