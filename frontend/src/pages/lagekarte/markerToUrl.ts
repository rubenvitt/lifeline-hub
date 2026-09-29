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
  personDetailPfad,
  betreuungPfad,
} from '../../routing/deeplinks';

/**
 * Bildet einen Karten-Marker auf seinen Fach-Modul-Deeplink ab — dünner Wrapper über die zentralen
 * deeplinks-Builder, keine eigenen Pfad-Templates.
 *
 * Nimmt den ganzen Marker: `lagemeldung` verlinkt auf die Quell-Meldung (`lageMeldung.meldungId`),
 * nicht auf `marker.id`. UHS und Schaden haben Item-Routen, die taktischen Listen
 * (Einheit/Fahrzeug/Personal/Abschnitt) werden per Query-Param selektiert.
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
    // Betroffene: Vollseiten-Detail → Item-Route.
    case 'person':
      return personDetailPfad(einsatzId, marker.id);
    // Betreuungsstelle: keine Detailroute, Auswahl per `?stelle=`.
    case 'betreuungsstelle':
      return betreuungPfad(einsatzId, { stelle: marker.id });
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
