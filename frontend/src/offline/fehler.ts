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

/**
 * Warum eine Erfassung vorgemerkt wurde (LLH-1758, `offline/AGENTS.md`, „Vorgemerkt heißt nicht
 * offline“). `serverfehler`: der eigene Anwendungsserver hat geantwortet (`{error}`-Umschlag),
 * aber nicht gespeichert (408, 429, 5xx). Alles andere Vormerkbare ist `offline`: Netzfehler,
 * Gateway-502/503/504 ohne Umschlag, Sitzungsfälle (401/412). Dieselbe Grenze zieht
 * `useOhneVerbindung` für „· offline“.
 */
export type VormerkGrund = 'offline' | 'serverfehler';

export function vormerkGrund(e: unknown): VormerkGrund {
  if (
    e instanceof ApiError &&
    e.vomAnwendungsserver &&
    (e.status === 408 || e.status === 429 || e.status >= 500)
  ) {
    return 'serverfehler';
  }
  return 'offline';
}
