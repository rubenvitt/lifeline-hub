import type { AbrufZustand } from '../api/abrufZustand';
import type { Fuehrungsstelle } from '../api/types';

/**
 * Die eigene Führungsstelle (LFH-849) als Quelle des Funkplans und der Fernmeldeskizze. Anders als
 * die Listen eine einzelne Angabe; `daten` ist `null`, solange sie nicht geladen ist.
 *
 * Herleitung: `openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md` (D4, D5).
 */
export interface FuehrungsstelleQuelle {
  zustand: AbrufZustand;
  daten: Fuehrungsstelle | null;
}

/** Wie die Führungsstelle in Lücke, Tabelle und Skizze heißt. */
export const FUEHRUNGSSTELLE_STELLE = 'Führungsstelle';

/**
 * Die eine Erfasst-Regel: eine der Angaben ist nicht leer, sie hat eine Verbindung (LLH-1134),
 * ihr ist eine Sprechgruppe oder ein Fahrzeug zugeordnet (LFH-1106), oder ein Einsatzleiter ist erfasst
 * (LFH-1199). Bezeichnung und Standort zählen mit, die Art nicht: sie hat immer einen Wert
 * (LFH-1181, design.md D1). Tabelle, Lücken-Hinweis, Bericht, Skizze, Organigramm und Lagekarte
 * fragen nur hier.
 */
export function fuehrungsstelleErfasst(fs: Fuehrungsstelle | null): boolean {
  if (!fs) return false;
  return (
    !!fs.bezeichnung?.trim() ||
    !!fs.standort_adresse?.trim() ||
    fs.standort_lat != null ||
    !!fs.rufname?.trim() ||
    fs.verbindungen.length > 0 ||
    fs.sprechgruppen.length > 0 ||
    fs.fahrzeug_ids.length > 0 ||
    fs.einsatzleiter != null
  );
}
