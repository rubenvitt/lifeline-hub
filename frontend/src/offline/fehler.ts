import { ApiError, NetzFehler } from '../api/client';

/** Transiente Schreibfehler bleiben in der persistenten Queue. Fachliche
 * 4xx-Ablehnungen werden sichtbar abgelehnt statt endlos erneut gesendet. */
export function istOfflineTransient(e: unknown): boolean {
  if (e instanceof NetzFehler || e instanceof TypeError) return true;
  if (e instanceof ApiError) {
    // 412 = die Sitzung gehört einem anderen Benutzer: Queue-Eigentümer-Konflikt oder (LFH-387)
    // abweichender erwarteter Benutzer des Tabs. Der Eintrag bleibt liegen; anders als eine echte
    // 401 darf er die gültige Sitzung des angemeldeten Benutzers nicht abmelden.
    return (
      e.status === 401 ||
      e.status === 408 ||
      e.status === 412 ||
      e.status === 429 ||
      e.status >= 500
    );
  }
  return false;
}
