import { useCallback, useMemo, useRef } from 'react';
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
 * Schreiben schon abgehängt), die Antwort verwerfen, ein Fehlschlag kostet nur eine Zählung.
 * Anders als dort zählt der Wert auf: geschrieben wird auf dem frisch geholten Serverstand. Beide Hooks teilen das Fach
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

  /**
   * Ausführungen der Reihe nach (Review vor dem PR): jede wartet auf die vorige, holt den
   * AKTUELLEN Serverstand und schreibt erst dann. Aus dem Cache gebaut überschriebe ein alter Stand
   * (`staleTime: Infinity`) die Zahlen, die ein anderer Tab oder Rechner desselben Benutzers
   * inzwischen gezählt hat; das PUT ersetzt den ganzen Wert. Bleibt der Stand unbekannt, wird nicht
   * geschrieben: ein Vollersatz aus dem Nichts löschte alle Zahlen.
   */
  const kette = useRef<Promise<void>>(Promise.resolve());
  const zaehle = useCallback(
    (id: string) => {
      if (benutzerId == null || !SCHNELLAKTION_IDS.includes(id)) return;
      kette.current = kette.current.then(async () => {
        let stand: BenutzerEinstellungen;
        try {
          stand = await client.fetchQuery({
            queryKey: key,
            queryFn: ladeBenutzerEinstellungen,
            staleTime: 0,
          });
        } catch {
          return;
        }
        const wert = JSON.stringify(naechsterZaehler(leseZaehler(stand), id, SCHNELLAKTION_IDS));
        client.setQueryData<BenutzerEinstellungen>(key, (alt) => ({
          ...alt,
          eintraege: { ...alt?.eintraege, [SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER]: wert },
        }));
        // Abgewartet, damit die nächste Ausführung diesen Stand vom Server liest; ein Fehlschlag
        // kostet eine Zählung, die Palette ist längst zu.
        await setzeBenutzerEinstellung(SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER, wert).catch(() => {});
      });
    },
    [benutzerId, client, key],
  );

  return useMemo(() => ({ zaehlung, zaehle }), [zaehlung, zaehle]);
}
