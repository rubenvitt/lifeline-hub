import { useCallback } from 'react';
import { effektivesKoordinatenformat } from '../anzeige/format';
import { useKoordinatenSystemOverride } from '../anzeige/koordinatenSystemStore';
import { erkenneKoordinate } from '../anzeige/koordinatenErkennung';
import { koordinatenBefehl } from './koordinatenSprung';
import type { Befehl, Oeffnung, PaletteModus } from './typen';
import { useLagekarteZugang } from './useLagekarteZugang';

/**
 * Beschaffung für den Koordinatensprung: Rechte (`useLagekarteZugang`) und eingestelltes Format.
 * Abgefragt wird erst, wenn der ENTPRELLTE Rest die Form einer Koordinate hat.
 *
 * Rückgabe ist eine FUNKTION über den lebenden Rest, damit nach dem Löschen einer Ziffer nicht
 * 300 ms lang ein veralteter Punkt dasteht.
 */
export function useKoordinatenSprung({
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
  const override = useKoordinatenSystemOverride();
  const aktiv = einsatzId != null && modus === 'alles' && erkenneKoordinate(suche) !== null;
  const { frei, einsatzFormat, orgFormat } = useLagekarteZugang(einsatzId, aktiv);

  return useCallback(
    (rest: string) => {
      if (einsatzId == null || modus !== 'alles' || !frei) return null;
      const punkt = erkenneKoordinate(rest);
      if (!punkt) return null;
      const format = effektivesKoordinatenformat(override, einsatzFormat, orgFormat) ?? 'wgs84';
      return koordinatenBefehl({ einsatzId, punkt, format, navigate });
    },
    [einsatzId, modus, frei, einsatzFormat, orgFormat, override, navigate],
  );
}
