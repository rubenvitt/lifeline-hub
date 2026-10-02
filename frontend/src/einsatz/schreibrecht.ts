import type { BenutzerAnzeige, EinsatzAnzeige } from '../api/types';

/**
 * Zentrale Quelle für die Einsatz-Schreibrecht-Regel „darf der aktuelle Benutzer in diesem
 * Einsatz schreiben?". Reine Funktionen; `schreibrecht.guard.test.ts` verbietet rohe
 * `meine_rolle`-Vergleiche außerhalb dieser Datei.
 *
 * Zwei Achsen, strikt getrennt: die Einsatz-Funktionen kennen NUR `status`, `meine_rolle` und
 * System-`admin`. Objekt-Gates (`br.status`, `istEntwurf`, `quittiert_at` …) bleiben am
 * Aufrufort und werden dort mit `lokal && darfImEinsatzSchreiben(...)` verknüpft. Die ORG-Achse
 * (`darfVerwaltung`) steht am Dateiende mit eigenem Kontext-Typ.
 *
 * Norm: `aktiv && (EL || FüPers || System-Admin)`. Reine UI-Schranke; die verbindliche
 * Autorisierung erzwingt das Backend.
 */

/** Nur die zwei Einsatz-Felder, die die Regel braucht — `Pick` + nullable, damit
 *  Partial-Fixtures und `einsatzQuery.data?.`-Aufrufstellen ohne Cast durchlaufen. */
export type EinsatzSchreibkontext =
  Pick<EinsatzAnzeige, 'status' | 'meine_rolle'> | null | undefined;

/** Nur die System-Rolle des Benutzers (für den Admin-Zweig). */
export type BenutzerSchreibkontext = Pick<BenutzerAnzeige, 'system_rolle'> | null | undefined;

/** System-Admin (globale Rolle). Einziger erlaubter `system_rolle`-Vergleich im Einsatz-Kontext. */
export function istAdmin(benutzer?: BenutzerSchreibkontext): boolean {
  return benutzer?.system_rolle === 'admin';
}

/** Beobachter-Rolle im Einsatz (rein lesend). */
export function istBeobachter(einsatz?: EinsatzSchreibkontext): boolean {
  return einsatz?.meine_rolle === 'beobachter';
}

/** Strikte Einsatzleitungs-Rolle — ohne aktiv-Status und OHNE Admin; für EL-Lese-Gates wie die
    Audit-Trail-Sichtbarkeit. */
export function istEinsatzLeitung(einsatz?: EinsatzSchreibkontext): boolean {
  return einsatz?.meine_rolle === 'einsatzleitung';
}

/** Leitungs-Schreibrecht: aktiver Einsatz UND (Einsatzleitung ODER System-Admin) — für
    Leitungsaktionen (Mitglieder/Module verwalten, ETB abschließen, Abgleich entscheiden). */
export function darfEinsatzLeiten(
  einsatz?: EinsatzSchreibkontext,
  benutzer?: BenutzerSchreibkontext,
): boolean {
  return einsatz?.status === 'aktiv' && (istEinsatzLeitung(einsatz) || istAdmin(benutzer));
}

/** Allgemeines Einsatz-Schreibrecht: aktiver Einsatz UND (Einsatzleitung ODER Führungspersonal
    ODER System-Admin) — die Norm für die Schreib-UI aller Einsatz-Module. */
export function darfImEinsatzSchreiben(
  einsatz?: EinsatzSchreibkontext,
  benutzer?: BenutzerSchreibkontext,
): boolean {
  return (
    einsatz?.status === 'aktiv' &&
    (einsatz?.meine_rolle === 'einsatzleitung' ||
      einsatz?.meine_rolle === 'fuehrungspersonal' ||
      istAdmin(benutzer))
  );
}

/** Original eines Bild-Anhangs mit Standort- und Gerätedaten laden (LFH-747, Spec
    `anhang-metadaten`): Einsatzleitung ODER System-Admin, unabhängig vom Einsatzstatus (auch im
    abgeschlossenen Einsatz). Reine UI-Schranke: das Backend verlangt beim Admin zusätzlich die
    Org des Einsatzes und vermerkt jeden Abruf im ETB. */
export function darfOriginalLaden(
  einsatz?: EinsatzSchreibkontext,
  benutzer?: BenutzerSchreibkontext,
): boolean {
  return istEinsatzLeitung(einsatz) || istAdmin(benutzer);
}

// ─── ORG-Achse ─────────────────────────────────────────────────────────────────────────────
//
// `darfVerwaltung` fragt „darf er die Organisation verwalten?" — ohne `einsatz`, `status` oder
// `meine_rolle`. Die Trennung trägt ein EIGENER Kontext-Typ (`BenutzerVerwaltungskontext`):
// wer die Achsen mischt, merkt es am Typ. Die Einsatz-Funktionen oben kennen kein `org_rolle`.

/** Nur die zwei Benutzer-Felder der Org-Achse — getrennt von `BenutzerSchreibkontext`, damit die
    Achsen nicht über einen gemeinsamen Typ verschmelzen. */
type BenutzerVerwaltungskontext =
  Pick<BenutzerAnzeige, 'system_rolle' | 'org_rolle'> | null | undefined;

/**
 * Zugang zum Verwaltungsbereich (`/admin` samt Stammdaten): System-Admin ODER Führungskraft der
 * Organisation. Die EINE Quelle für dieses Gate (erzwungen von `verwaltungsrecht.guard.test.ts`).
 * NICHT für die Benutzerverwaltung: die ist strenger und bleibt bei `istAdmin`.
 */
export function darfVerwaltung(benutzer?: BenutzerVerwaltungskontext): boolean {
  return benutzer?.system_rolle === 'admin' || benutzer?.org_rolle === 'fuehrungskraft';
}
