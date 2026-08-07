import { ApiError, NetzFehler } from '../api/client';

/** Transiente Schreibfehler bleiben in der persistenten Queue. Fachliche
 * 4xx-Ablehnungen werden sichtbar abgelehnt statt endlos erneut gesendet. */
export function istOfflineTransient(e: unknown): boolean {
  if (e instanceof NetzFehler || e instanceof TypeError) return true;
  if (e instanceof ApiError) {
    // 412 ist bei diesen drei offlinefähigen Endpunkten exklusiv der
    // Queue-Eigentümer-Konflikt. Anders als eine echte 401 darf er die gültige
    // Sitzung des inzwischen angemeldeten Benutzers nicht abmelden.
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
