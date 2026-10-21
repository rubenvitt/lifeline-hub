import type { GefahrBewertung, Gefahrentyp, Schutzobjekt } from '../../api/types';
import { GEFAHRENTYPEN_ALPHABETISCH, SCHUTZOBJEKTE, kombinationGueltig } from './gefahrenSchema';

/**
 * Erläuterungen der Gefahrenbewertung (LLH-1110, Spec `gefahrenmatrix`, „Erläuterungen sind
 * sichtbar“): EINE Stelle für die Frage, welche Zellen etwas zu sagen haben, und für ihre Folge.
 * Abnehmer: Marke und Liste der Gefahrenseite, das Paneel „Gefahrenmatrix“ im Lagebild und der
 * Matrixauszug der Sprungpalette (LLH-1365), der Inspector eines Gefahrengebiets auf der Lagekarte
 * und die Übernahme „Gefahren-/Schadenlage“ in den Lagevortrag. Die Erläuterung ist das
 * Wire-Feld `beschreibung`.
 */

/**
 * Zusatz am zugänglichen Namen einer Zelle mit Erläuterung — die Marke selbst ist für Hilfstechnik
 * verborgen (`ErlaeuterungsMarke.tsx`). Eine Schreibweise für Matrix, Paneel und Auszug.
 */
export const MIT_ERLAEUTERUNG = ' · mit Erläuterung';

/** Trägt die Zelle eine Erläuterung? Leerraum allein ist keine. */
export function hatErlaeuterung(zelle: Pick<GefahrBewertung, 'beschreibung'>): boolean {
  return (zelle.beschreibung ?? '').trim() !== '';
}

const GEFAHR_RANG = new Map(GEFAHRENTYPEN_ALPHABETISCH.map((g, i) => [g.wert, i]));
const OBJEKT_RANG = new Map(SCHUTZOBJEKTE.map((s, i) => [s.wert, i]));

/**
 * Gültige Zellen in der Folge der Matrix: alphabetisch nach Gefahr (LLH-1102), darin in der
 * Spaltenfolge der Schutzobjekte. Ein nicht anwendbares Paar fällt heraus.
 */
function ordneZellen(zellen: readonly GefahrBewertung[]): GefahrBewertung[] {
  return zellen
    .filter((z) => kombinationGueltig(z.gefahrentyp, z.schutzobjekt))
    .sort(
      (a, b) =>
        (GEFAHR_RANG.get(a.gefahrentyp) ?? 0) - (GEFAHR_RANG.get(b.gefahrentyp) ?? 0) ||
        (OBJEKT_RANG.get(a.schutzobjekt) ?? 0) - (OBJEKT_RANG.get(b.schutzobjekt) ?? 0),
    );
}

/** Jede gültige Zelle mit Erläuterung, in der Folge der Matrix — die Liste „Erläuterungen“. */
export function zellenMitErlaeuterung(matrix: readonly GefahrBewertung[]): GefahrBewertung[] {
  return ordneZellen(matrix.filter(hatErlaeuterung));
}

/**
 * Was ein Gebiet an Gefahren zu sagen hat (Lagebild-Paneel und Palettenauszug: welche Zeilen,
 * LLH-1365; Karte, Lagevortrag): jede gültige Zelle über „keine“ UND jede mit Erläuterung, auch
 * zu „keine“ — „geprüft, kein Strom im Keller“ ist eine Beurteilung (LLH-1110 design.md E5).
 * Folge wie die Matrix.
 */
export function gesetzteGefahren(matrix: readonly GefahrBewertung[]): GefahrBewertung[] {
  return ordneZellen(matrix.filter((z) => z.warnstufe !== 'keine' || hatErlaeuterung(z)));
}

/** „Elektrizität × Menschen“ — Titel der Zelle in Liste, Dialog, Karte und Vortrag. */
export function zellTitel(typ: Gefahrentyp, objekt: Schutzobjekt): string {
  const gefahr = GEFAHRENTYPEN_ALPHABETISCH.find((g) => g.wert === typ)?.label ?? typ;
  const schutzobjekt = SCHUTZOBJEKTE.find((s) => s.wert === objekt)?.label ?? objekt;
  return `${gefahr} × ${schutzobjekt}`;
}

/** Die Erläuterung als eine Zeile (Karte, Vortrag): Leerraum und Umbrüche zu einem Leerzeichen. */
export function erlaeuterungEinzeilig(zelle: Pick<GefahrBewertung, 'beschreibung'>): string {
  return (zelle.beschreibung ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * „geändert 101512OKT26 · Name“; ohne Namen (Konto entfernt) nur die Zeit. Die Zeit formatiert der
 * Aufrufer in der Anzeigezone (`useAnzeigeKonventionen().formatZeit`), wie `beurteilungText`.
 */
export function geaendertText(
  zelle: Pick<GefahrBewertung, 'geaendert_at' | 'aktualisiert_von_name'>,
  formatZeit: (utc: string) => string,
): string {
  const zeit = `geändert ${formatZeit(zelle.geaendert_at)}`;
  return zelle.aktualisiert_von_name ? `${zeit} · ${zelle.aktualisiert_von_name}` : zeit;
}
