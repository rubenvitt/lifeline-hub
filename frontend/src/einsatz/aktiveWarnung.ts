/**
 * Was „aktive Warnung" für die Warnsperre des Helligkeitsreglers heißt (LFH-397,
 * `openspec/changes/lfh-397-helligkeitsregler-warnsperre/design.md` D3).
 *
 * ZWEI MERKMALE, beide im geöffneten Einsatz:
 *  (a) die höchste Warnstufe der Gefahrengebiete ist eine, die der Statusvertrag
 *      `warnstufeKennzahl` auf `alarm` legt (heute `hoch`/`akut`) — gelesen aus dem
 *      Vertrag, nicht aus einer zweiten Stufenliste: ändert sich der Vertrag, zieht die
 *      Sperre mit;
 *  (b) mindestens eine Meldung hat eine überfällige Bestätigungspflicht
 *      (`meldungen.bestaetigung_ueberfaellig` des Modulzählers, Regel `istAlarmiert`).
 *
 * BEWUSST NICHT: „irgendeine Statusrolle `alarm`" (defektes Material, überfällige
 * Ablösung sind Arbeit auf einer Liste, keine Warnung, die man wegdimmen könnte);
 * DWD-Unwetter (nur seitenlokal abgefragt, Folgeticket).
 *
 * Eine fehlende Quelle — kein Modulrecht, lädt noch, Abruf gescheitert — ist `undefined`
 * und trägt nichts bei: eine Sperre ohne Beleg verböte das Dimmen, ohne dass jemand sieht,
 * warum.
 */
import type { Warnstufe } from '../api/types';
import { warnstufeKennzahl } from '../theme/statusFarben';

export interface Warnmerkmale {
  hoechsteWarnstufe?: Warnstufe;
  bestaetigungUeberfaellig?: number;
}

export function aktiveWarnung({
  hoechsteWarnstufe,
  bestaetigungUeberfaellig,
}: Warnmerkmale): boolean {
  const warnstufeSperrt =
    hoechsteWarnstufe !== undefined && warnstufeKennzahl[hoechsteWarnstufe].rolle === 'alarm';
  return warnstufeSperrt || (bestaetigungUeberfaellig ?? 0) > 0;
}
