import { einsatzKeys } from '../api/queryKeys';

/**
 * Was eine Buchung „Eintreffen“ am Bereitstellungsraum ändert (LLH-1075): Raum und Verlauf,
 * Einheiten und Fahrzeuge (eine unangemeldete Kraft und eine aus den Stammdaten legen beide an), Zeitachse, Meldung an die
 * Einsatzleitung und ETB. Der Dialog nach dem Senden und der Abgleich der Offline-Queue nach dem
 * Nachsenden (Teil III) laden dieselben Daten nach. `brDetail` steht vorn: der Abgleich wartet auf
 * ihn, bevor die Zeile „vorgemerkt“ verschwindet.
 */
export function eintreffenQueryKeys(einsatzId: number, brId: number) {
  return [
    einsatzKeys.brDetail(einsatzId, brId),
    einsatzKeys.br(einsatzId),
    einsatzKeys.brVerlauf(einsatzId, brId),
    // Eine aus den Stammdaten gebuchte Einheit ist danach kein Stamm-Treffer mehr (LLH-1300).
    einsatzKeys.brStammTreffer(einsatzId, brId),
    einsatzKeys.einheiten(einsatzId),
    einsatzKeys.fahrzeuge(einsatzId),
    einsatzKeys.kraefteZeitachse(einsatzId),
    einsatzKeys.meldungen(einsatzId),
    einsatzKeys.etb(einsatzId),
  ] as const;
}
