/**
 * Die gemerkte Stellenwahl der Ausgabeansicht (LLH-1040, design.md D13 Punkt 7; Spec
 * `browserspeicher`).
 *
 * Am Desktop merkt sich die Ausgabeansicht je Einsatz, an welcher Stelle gezählt wird; am Gerät
 * nicht (Bindung LLH-1048). Gespeichert ist nur die Kennung, die Stelle selbst liefert der Server
 * wieder. Deshalb räumt jeder Ausgang den Eintrag (`GERAETESPEICHER`, `jeder-ausgang`). Ohne
 * Speicher wirkt die Wahl bis zum Verlassen der Seite.
 */
import {
  sicherEntfernen,
  sicherLesen,
  sicherSchluessel,
  sicherSchreiben,
} from '../lib/sichererSpeicher';
import { parseRouteId } from '../routing/deeplinks';

const PRAEFIX = 'lfh:verpflegung:stelle:';

function schluessel(einsatzId: number): string {
  return `${PRAEFIX}${einsatzId}`;
}

/** Die gemerkte Stelle des Einsatzes, oder `null` (nichts gemerkt, fremder Wert, kein Speicher). */
export function liesGemerkteStelle(einsatzId: number): number | null {
  return parseRouteId(sicherLesen(schluessel(einsatzId)) ?? undefined);
}

/** Merkt die Wahl; „ohne Stelle“ (`null`) entfernt den Eintrag. Wirft nie. */
export function merkeStelle(einsatzId: number, stelleId: number | null): void {
  if (stelleId == null) sicherEntfernen(schluessel(einsatzId));
  else sicherSchreiben(schluessel(einsatzId), String(stelleId));
}

/** Abmelden und Sitzungsende (`offline/geraetRaeumung.ts`): alle gemerkten Stellen. */
export function gemerkteStellenRaeumen(): void {
  for (const k of sicherSchluessel()) {
    if (k.startsWith(PRAEFIX)) sicherEntfernen(k);
  }
}
