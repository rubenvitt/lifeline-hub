/**
 * „Ausblenden“ der Startliste im Überblick, je Browser und Einsatz (LLH-1815, Spec
 * `ueberblick-startliste`, design.md D4). Gespeichert ist nur, DASS die Liste für diesen Einsatz
 * ausgeblendet ist; ein anderes Gerät zeigt sie weiter. Ohne Speicher wirkt das Ausblenden bis zum
 * Neuladen (die Seite setzt erst ihren State, dann schreibt sie). Abmelden und Sitzungsende räumen
 * den Eintrag (`GERAETESPEICHER`, `jeder-ausgang`).
 */
import {
  sicherEntfernen,
  sicherLesen,
  sicherSchluessel,
  sicherSchreiben,
} from '../../lib/sichererSpeicher';

const PRAEFIX = 'startliste-ausgeblendet:';

function schluessel(einsatzId: number): string {
  return `${PRAEFIX}${einsatzId}`;
}

/** Ist die Startliste dieses Einsatzes in diesem Browser ausgeblendet? Ohne Speicher: nein. */
export function isStartlisteAusgeblendet(einsatzId: number): boolean {
  return sicherLesen(schluessel(einsatzId)) === '1';
}

/** Merkt das Ausblenden; `false`, wenn der Speicher gesperrt oder voll ist. Wirft nie. */
export function saveStartlisteAusgeblendet(einsatzId: number): boolean {
  return sicherSchreiben(schluessel(einsatzId), '1');
}

/** Abmelden und Sitzungsende (`offline/geraetRaeumung.ts`): alle Einsätze. */
export function clearStartlisteAusgeblendet(): void {
  for (const k of sicherSchluessel()) {
    if (k.startsWith(PRAEFIX)) sicherEntfernen(k);
  }
}
