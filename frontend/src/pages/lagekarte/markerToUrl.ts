import type { KarteMarker } from './marker';
import {
  uhsDetailPfad,
  schadenDetailPfad,
  einheitenPfad,
  fahrzeugePfad,
  personalPfad,
  einsatzabschnittePfad,
  meldungenPfad,
  einsatzdatenPfad,
} from '../../routing/deeplinks';

/**
 * Lagekarte-lokaler Adapter: bildet einen Karten-Marker auf seinen Fach-Modul-Deeplink ab
 * (LFH-25). Dünner Wrapper über die zentralen deeplinks-Builder — KEINE eigenen Pfad-Templates.
 *
 * Nimmt bewusst den ganzen Marker (nicht typ+id): `lagemeldung` verlinkt auf die QUELL-Meldung
 * (`lageMeldung.meldungId`), nicht auf `marker.id` (= LageMeldung-id). UHS hat eine echte
 * Item-Route; Schaden hat seit LFH-148 ebenfalls eine Vollseiten-Item-Route; die taktischen
 * Listen (Einheit/Fahrzeug/Personal/Abschnitt) werden per Query-Param selektiert.
 */
export function markerToUrl(marker: KarteMarker, einsatzId: number): string {
  switch (marker.typ) {
    case 'uhs':
      return uhsDetailPfad(einsatzId, marker.id);
    case 'schaden':
      return schadenDetailPfad(einsatzId, marker.id);
    case 'einheit':
      return einheitenPfad(einsatzId, { einheit: marker.id });
    case 'fahrzeug':
      return fahrzeugePfad(einsatzId, { fahrzeug: marker.id });
    case 'fuehrung':
      return personalPfad(einsatzId, { personal: marker.id });
    case 'abschnitt':
      return einsatzabschnittePfad(einsatzId, { abschnitt: marker.id });
    case 'lagemeldung':
      return meldungenPfad(
        einsatzId,
        marker.lageMeldung ? { meldung: marker.lageMeldung.meldungId } : {},
      );
    case 'einsatzort':
    default:
      return einsatzdatenPfad(einsatzId);
  }
}
