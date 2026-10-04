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
 * Die eine Erfasst-Regel: eine der Angaben ist nicht leer, oder ihr ist mindestens eine
 * Sprechgruppe zugeordnet. Tabelle, Lücken-Hinweis, Bericht und Skizze fragen nur hier.
 */
export function fuehrungsstelleErfasst(fs: Fuehrungsstelle | null): boolean {
  if (!fs) return false;
  return (
    !!fs.rufname?.trim() ||
    !!fs.kommunikationsmittel?.trim() ||
    !!fs.erreichbarkeit?.trim() ||
    fs.sprechgruppen.length > 0
  );
}
