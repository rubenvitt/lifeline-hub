import type { BenutzerEinstellungen } from './types';
import { apiGet, apiSend } from './client';

/**
 * Präferenzen des ANGEMELDETEN Benutzers laden (GET /api/benutzer-einstellungen).
 *
 * Es gibt keinen Endpunkt für ein fremdes Fach — die `benutzer_id` stammt serverseitig
 * ausschliesslich aus der Sitzung. Deshalb nimmt diese Funktion kein Argument, und deshalb
 * ist die Trennung zweier Benutzer strukturell und nicht bloss geprüft.
 *
 * Ohne gespeicherte Zeile antwortet der Server mit `{"eintraege":{}}` und OHNE
 * `geaendert_at` (kein 404): „noch nie geschrieben" ist der Normalfall beim ersten Login.
 */
export function ladeBenutzerEinstellungen(): Promise<BenutzerEinstellungen> {
  return apiGet<BenutzerEinstellungen>('/api/benutzer-einstellungen');
}

/**
 * Einen Schlüssel setzen (PUT /api/benutzer-einstellungen/{schluessel}, UPSERT).
 *
 * Der Server antwortet mit dem VOLLEN neuen Stand, nicht nur mit dem geschriebenen
 * Schlüssel — ein zweiter Request nach dem Schreiben ist also nie nötig.
 *
 * Der Schlüsselraum ist serverseitig eine Whitelist: ein unbekannter Schlüssel, ein leerer
 * und ein überlanger Wert sind je 400 (die Eingabe scheitert am Feld, nicht am
 * Zusammenhang). Zum Leeren einer Liste wird `'[]'` geschickt, nicht `''`.
 */
export function setzeBenutzerEinstellung(
  schluessel: string,
  wert: string,
): Promise<BenutzerEinstellungen> {
  return apiSend<BenutzerEinstellungen>(
    `/api/benutzer-einstellungen/${encodeURIComponent(schluessel)}`,
    'PUT',
    { wert },
  );
}
