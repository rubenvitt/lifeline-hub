import type { BenutzerAnzeige, EinsatzAnzeige } from '../api/types';

/**
 * Zentrale Wahrheitsquelle für die Einsatz-Level-Schreibrecht-Regel (LFH-234).
 *
 * Ersetzt die zuvor über ~29 Dateien in vier divergenten Varianten kopierte Inline-Regel
 * „darf der aktuelle Benutzer in diesem Einsatz schreiben?". Reine, unit-getestete Funktionen
 * im Stil von `routing/deeplinks.ts` / `api/queryKeys.ts`. Ein Guard-Test
 * (`schreibrecht.guard.test.ts`) verbietet rohe `meine_rolle`-Vergleiche außerhalb dieser Datei.
 *
 * Zwei-Achsen-Trennung (strikt): Die Einsatz-Schreibrecht-Funktionen kennen NUR die Einsatz-Achse
 * (`status` + `meine_rolle` + System-`admin`). Objekt-Level-Gates (z.B. `br.status`,
 * `istEntwurf`, `ist_offen`, `quittiert_at`) bleiben am Aufrufort lokal und werden dort mit
 * `lokal && darfImEinsatzSchreiben(...)` verknüpft — NICHT in den Helfer falten.
 *
 * Seit LFH-328 wohnt am Ende der Datei zusätzlich `darfVerwaltung` — die ORG-Achse
 * (`system_rolle` + `org_rolle`, ohne jeden Einsatzbezug). Sie steht bewusst UNTERHALB eines
 * eigenen Abschnitts-Kommentars und trägt einen eigenen Kontext-Typ, damit die Trennung sichtbar
 * bleibt: die Einsatz-Achse kennt weiterhin keinen `org_rolle`-Begriff.
 *
 * Norm (admin-global, bewusste Entscheidung LFH-234): `aktiv && (EL || FüPers || System-Admin)`.
 * System-Admin darf in jedem Einsatz-Modul schreiben, der aktive Status bleibt vorausgesetzt.
 *
 * Hinweis: reine UI-/UX-Schranke. Die verbindliche Autorisierung erzwingt das Backend.
 */

/** Nur die zwei Einsatz-Felder, die die Regel braucht — `Pick` + nullable, damit
 *  Partial-Fixtures und `einsatzQuery.data?.`-Aufrufstellen ohne Cast durchlaufen. */
export type EinsatzSchreibkontext = Pick<EinsatzAnzeige, 'status' | 'meine_rolle'> | null | undefined;

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

/** Strikte Einsatzleitungs-Rolle — aktiv-frei und OHNE Admin. Für EL-Read-Gates
 *  (z.B. Audit-Trail-Sichtbarkeit), die weder den aktiv-Status noch den System-Admin einbeziehen. */
export function istEinsatzLeitung(einsatz?: EinsatzSchreibkontext): boolean {
  return einsatz?.meine_rolle === 'einsatzleitung';
}

/** Leitungs-Schreibrecht: aktiver Einsatz UND (Einsatzleitung ODER System-Admin).
 *  Für Leitungsaktionen (Mitglieder/Module verwalten, ETB abschließen, Abgleich entscheiden). */
export function darfEinsatzLeiten(
  einsatz?: EinsatzSchreibkontext,
  benutzer?: BenutzerSchreibkontext,
): boolean {
  return einsatz?.status === 'aktiv' && (istEinsatzLeitung(einsatz) || istAdmin(benutzer));
}

/** Allgemeines Einsatz-Schreibrecht: aktiver Einsatz UND (Einsatzleitung ODER Führungspersonal
 *  ODER System-Admin). Die einheitliche Norm für die Schreib-UI aller Einsatz-Module. */
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

// ─── ORG-Achse (LFH-328) ────────────────────────────────────────────────────────────────────
//
// Ab hier endet die Einsatz-Achse. `darfVerwaltung` beantwortet eine ANDERE Frage: nicht „darf
// der Benutzer in DIESEM Einsatz schreiben?", sondern „darf er die Organisation verwalten?" —
// ohne `einsatz`-Argument, ohne `status`, ohne `meine_rolle`.
//
// Warum trotzdem hier und nicht in einer eigenen Datei: es ist dieselbe Sorte Regel (reine,
// unit-getestete Berechtigungsfunktion über den angemeldeten Benutzer) mit demselben Problem
// (sie lag byte-gleich dreifach kopiert herum, siehe `verwaltungsrecht.guard.test.ts`), und eine
// zweite Ein-Funktions-Datei daneben hätte nur die Frage „welche der beiden?" erzeugt. Die
// Trennung wird stattdessen über einen EIGENEN Kontext-Typ getragen: `darfVerwaltung` nimmt
// `BenutzerVerwaltungskontext`, nicht `BenutzerSchreibkontext` — wer die Achsen mischt, merkt es
// am Typ. Die Einsatz-Funktionen oben bleiben frei von `org_rolle`.

/** Nur die zwei Benutzer-Felder der Org-Achse — bewusst getrennt von `BenutzerSchreibkontext`
 *  (das nur `system_rolle` kennt), damit die Achsen nicht über einen gemeinsamen Typ verschmelzen. */
export type BenutzerVerwaltungskontext =
  | Pick<BenutzerAnzeige, 'system_rolle' | 'org_rolle'>
  | null
  | undefined;

/** Zugang zum Verwaltungsbereich (`/admin` samt Stammdaten): System-Admin ODER Führungskraft
 *  der Organisation. Die EINE Quelle für dieses Gate — Topbar, Admin-Route und Kommandopalette
 *  fragen alle hier. Erzwungen von `verwaltungsrecht.guard.test.ts`.
 *
 *  Achtung, NICHT für die Benutzerverwaltung: die ist strenger (nur System-Admin) und bleibt
 *  bei `istAdmin`. */
export function darfVerwaltung(benutzer?: BenutzerVerwaltungskontext): boolean {
  return benutzer?.system_rolle === 'admin' || benutzer?.org_rolle === 'fuehrungskraft';
}
