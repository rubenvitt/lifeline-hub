import { useCallback } from 'react';
import { adressBefehl, istAdressEingabe } from './adressSprung';
import type { Befehl, Oeffnung, PaletteModus } from './typen';
import { useLagekarteZugang } from './useLagekarteZugang';

/**
 * Beschaffung für die Adresszeile (LFH-638): dieselbe Rechteprüfung wie der Koordinatensprung
 * (`useLagekarteZugang`), abgefragt erst, wenn der ENTPRELLTE Rest eine Adresse sein kann. Der
 * Geocoder wird hier nie gefragt — die Zeile springt nur.
 *
 * Rückgabe ist eine FUNKTION über den lebenden Rest, wie bei `useKoordinatenSprung`.
 */
export function useAdressSprung({
  einsatzId,
  modus,
  suche,
  navigate,
}: {
  einsatzId: number | null;
  modus: PaletteModus;
  /** Der ENTPRELLTE Rest hinter dem Präfix. */
  suche: string;
  navigate: (pfad: string, oeffnung?: Oeffnung) => void;
}): (rest: string) => Befehl | null {
  const aktiv = einsatzId != null && modus === 'alles' && istAdressEingabe(suche);
  const { frei } = useLagekarteZugang(einsatzId, aktiv);

  return useCallback(
    (rest: string) => {
      if (einsatzId == null || modus !== 'alles' || !frei) return null;
      if (!istAdressEingabe(rest)) return null;
      return adressBefehl({ einsatzId, text: rest, navigate });
    },
    [einsatzId, modus, frei, navigate],
  );
}
