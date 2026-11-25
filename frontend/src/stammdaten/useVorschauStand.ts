import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { LEERE_ENTSCHEIDUNGEN } from '../api/stammdatenEingang';
import type { StammdatenEntscheidungen, StammdatenVorschau } from '../api/types';

/**
 * Die letzte gelungene Vorschau des Stammdaten-Eingangs (LLH-1633, LLH-1194), gleich für Datei
 * und Schnappschuss. Jede Wahl fragt die Vorschau neu; schlägt eine Abfrage fehl (etwa eine Wahl,
 * die der Server ablehnt), bleibt die letzte Vorschau stehen und die Entscheidungen springen auf
 * ihren Stand zurück. `A` ist, was außer den Entscheidungen zur Anfrage gehört (Datei und
 * Herkunft oder die Kennung des Schnappschusses); der Stand merkt sie sich mit.
 */
export interface VorschauStand<A> {
  vorschau: StammdatenVorschau;
  anfrage: A;
  entscheidungen: StammdatenEntscheidungen;
}

interface FrageFolgen<A> {
  onSuccess?: (v: StammdatenVorschau) => void;
  /** Nach dem Zurücknehmen; bekommt den Stand, auf den zurückgesprungen wurde. */
  onError?: (vorher: VorschauStand<A> | null) => void;
}

export function useVorschauStand<A>(
  abfrage: (anfrage: A, e: StammdatenEntscheidungen) => Promise<StammdatenVorschau>,
) {
  const [entscheidungen, setEntscheidungen] =
    useState<StammdatenEntscheidungen>(LEERE_ENTSCHEIDUNGEN);
  const [stand, setStand] = useState<VorschauStand<A> | null>(null);
  const mutation = useMutation({
    mutationFn: (v: { anfrage: A; e: StammdatenEntscheidungen }) => abfrage(v.anfrage, v.e),
  });

  const frage = (anfrage: A, e: StammdatenEntscheidungen, folgen: FrageFolgen<A> = {}) => {
    mutation.mutate(
      { anfrage, e },
      {
        onError: () => {
          // Zurück auf den Stand der letzten Vorschau, damit es weitergehen kann.
          setEntscheidungen(stand?.entscheidungen ?? LEERE_ENTSCHEIDUNGEN);
          folgen.onError?.(stand);
        },
        onSuccess: (v) => {
          setStand({ vorschau: v, anfrage, entscheidungen: e });
          folgen.onSuccess?.(v);
        },
      },
    );
  };

  const zuruecksetzen = () => {
    setEntscheidungen(LEERE_ENTSCHEIDUNGEN);
    setStand(null);
    mutation.reset();
  };

  return {
    entscheidungen,
    setEntscheidungen,
    stand,
    vorschau: stand?.vorschau ?? null,
    frage,
    zuruecksetzen,
    laeuft: mutation.isPending,
    fehler: mutation.error,
  };
}
