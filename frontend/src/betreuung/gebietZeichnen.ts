import { lagekartePfad } from '../routing/deeplinks';

/**
 * Gebiet eines Evakuierungsbezirks auf der Lagekarte zeichnen (LLH-1069): Wortlaut und Ziel an
 * EINER Stelle für Anlegedialog, Tabellenmenü und Detailseite.
 */

/** „Gebiet zeichnen“ ohne Fläche, „Weitere Teilfläche zeichnen“ mit mindestens einer. */
export function gebietZeichnenText(flaechen: number): string {
  return flaechen > 0 ? 'Weitere Teilfläche zeichnen' : 'Gebiet zeichnen';
}

/**
 * Die Lagekarte im Zeichenmodus für eine Fläche dieses Bezirks
 * (`?zeichnen=evakuierungsbezirk&bezirk=<id>`); die Karte belegt Bezeichnung und Zuordnung vor.
 */
export function gebietZeichnenPfad(einsatzId: number, bezirkId: number): string {
  return lagekartePfad(einsatzId, { zeichnen: { typ: 'evakuierungsbezirk', bezirk: bezirkId } });
}
