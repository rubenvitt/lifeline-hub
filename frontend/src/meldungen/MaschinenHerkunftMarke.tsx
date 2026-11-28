import type { MaschinenHerkunft } from '../api/types';
import { Marke } from '../components/instrument';
import { herkunftKurz, herkunftText } from './maschinenHerkunft';

/**
 * Herkunft einer aus einem Vorschlag des Maschinen-Eingangs übernommenen Meldung (LLH-2112):
 * Herkunft, kein Zustand. An der Meldungskarte und in der Liste der Lagemeldungen dieselbe Marke.
 */
export default function MaschinenHerkunftMarke({
  herkunft,
}: {
  herkunft: MaschinenHerkunft | null | undefined;
}) {
  if (!herkunft) return null;
  return (
    <Marke data-lfh="meldung-maschinen-herkunft" title={herkunftText(herkunft)}>
      {`unverifiziert übernommen · ${herkunftKurz(herkunft)}`}
    </Marke>
  );
}
