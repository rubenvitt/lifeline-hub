import type { RundgangSchritt } from './rundgangTexte';

/** Ein Schritt mit dem Ziel, auf das er zeigt, und dem Text der gewählten Variante. */
export interface AufgeloesterSchritt {
  schritt: RundgangSchritt;
  ziel: HTMLElement;
  text: string;
}

/**
 * Sichtbar heißt: das Element nimmt Platz ein und weder es noch ein Vorfahr ist
 * `visibility: hidden` (die Kopfsuche wartet so auf den Einsatz, LLH-1726).
 */
export function istSichtbar(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  for (let k: Element | null = el; k; k = k.parentElement)
    if (getComputedStyle(k).visibility === 'hidden') return false;
  return true;
}

/**
 * Löst die Schritte gegen das DOM auf (LLH-1990): je Schritt die erste Variante mit einem
 * sichtbaren Ziel; Schritte ohne entfallen. Der Rundgang öffnet nichts, um ein Ziel zu zeigen.
 */
export function loeseSchritteAuf(
  schritte: readonly RundgangSchritt[],
  wurzel: ParentNode = document,
): AufgeloesterSchritt[] {
  const ergebnis: AufgeloesterSchritt[] = [];
  for (const schritt of schritte) {
    for (const variante of schritt.varianten) {
      const ziel = Array.from(wurzel.querySelectorAll<HTMLElement>(variante.anker)).find(
        istSichtbar,
      );
      if (ziel) {
        ergebnis.push({ schritt, ziel, text: variante.text });
        break;
      }
    }
  }
  return ergebnis;
}
