import type { BeginnQuelle } from '../api/types';

/**
 * Das Wort vor dem Beginn an der Karte (LLH-1312, Spec `kraefte-abloesung` „Herkunft des
 * Beginns“): von Hand „im Einsatz seit“, mit dem Eintreffen „seit Eintreffen“, als Folgeschicht
 * eines Vollzugs „Folgeschicht seit“. Die Herkunft schreibt der Server beim Anlegen; der Client
 * leitet nichts aus Vorgänger oder Zeitachse ab. Eine Zeile wie bisher, damit die Kartenhöhe
 * nicht an der Herkunft hängt (design.md D3).
 */
const BEGINN_WORT: Record<BeginnQuelle, string> = {
  hand: 'im Einsatz seit',
  eintreffen: 'seit Eintreffen',
  vollzug: 'Folgeschicht seit',
};

/** Ein unbekannter Wert (älterer Server) liest sich wie von Hand: so stand es vorher da. */
export function beginnWort(quelle: BeginnQuelle | undefined): string {
  return (quelle && BEGINN_WORT[quelle]) ?? BEGINN_WORT.hand;
}
