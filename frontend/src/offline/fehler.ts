import { ApiError, NetzFehler } from '../api/client';

/** Transiente Schreibfehler bleiben in der persistenten Queue. Fachliche
 * 4xx-Ablehnungen werden sichtbar abgelehnt statt endlos erneut gesendet. */
export function istOfflineTransient(e: unknown): boolean {
  if (e instanceof NetzFehler || e instanceof TypeError) return true;
  if (e instanceof ApiError) {
    // 412 hat zwei Quellen, beide „die Sitzung gehört einem anderen Benutzer“: der
    // Queue-Eigentümer-Konflikt an den offlinefähigen Endpunkten (ETB, Person, Meldung,
    // seit LFH-675 Stand- und Belegungsmeldung) und seit LFH-387 der erwartete Benutzer
    // des Tabs an jeder Schreibroute. In beiden Fällen bleibt der Eintrag liegen, bis
    // sein Benutzer wieder angemeldet ist; anders als eine echte 401 darf er die gültige
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
