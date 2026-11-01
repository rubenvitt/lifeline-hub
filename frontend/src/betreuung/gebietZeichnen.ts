import { lagekartePfad } from '../routing/deeplinks';

/**
 * Gebiet eines Evakuierungsbezirks auf der Lagekarte zeichnen (LLH-1069): Wortlaut und Ziel an
 * EINER Stelle für Anlegedialog, Tabellenmenü und Detailseite.
 */

/** „Gebiet zeichnen“ ohne Fläche, „Weitere Teilfläche zeichnen“ mit mindestens einer. */
export function gebietZeichnenText(flaechen: number): string {
  return flaechen > 0 ? 'Weitere Teilfläche zeichnen' : 'Gebiet zeichnen';
}

/** Ein Kreis als Gebiet (LLH-1346): Radius in Metern, Mitte nur, wenn sie feststeht. */
export interface GebietKreis {
  radius: number;
  mitte?: { lat: number; lon: number };
}

/**
 * Die Lagekarte im Zeichenmodus für eine Fläche dieses Bezirks
 * (`?zeichnen=evakuierungsbezirk&bezirk=<id>`); die Karte belegt Bezeichnung und Zuordnung vor.
 * Mit `kreis` (LLH-1346) als Kreis um einen Punkt
 * (`?zeichnen=evakuierungsbezirk:kreis&radius=<m>[&mitte=<lat>,<lon>]&bezirk=<id>`): Radius und
 * Mitte stehen vorbelegt, angelegt wird erst mit „Übernehmen“ auf der Karte.
 */
export function gebietZeichnenPfad(
  einsatzId: number,
  bezirkId: number,
  kreis?: GebietKreis,
): string {
  return lagekartePfad(einsatzId, {
    zeichnen: kreis
      ? { typ: 'evakuierungsbezirk', form: 'kreis', ...kreis, bezirk: bezirkId }
      : { typ: 'evakuierungsbezirk', bezirk: bezirkId },
  });
}
