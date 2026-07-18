import type { BenutzerAnzeige, EinsatzAnzeige } from '../api/types';

/**
 * Zentrale Wahrheitsquelle für die Einsatz-Level-Schreibrecht-Regel (LFH-234).
 *
 * Ersetzt die zuvor über ~29 Dateien in vier divergenten Varianten kopierte Inline-Regel
 * „darf der aktuelle Benutzer in diesem Einsatz schreiben?". Reine, unit-getestete Funktionen
 * im Stil von `routing/deeplinks.ts` / `api/queryKeys.ts`. Ein Guard-Test
 * (`schreibrecht.guard.test.ts`) verbietet rohe `meine_rolle`-Vergleiche außerhalb dieser Datei.
 *
 * Zwei-Achsen-Trennung (strikt): Diese Funktionen kennen NUR die Einsatz-Achse
 * (`status` + `meine_rolle` + System-`admin`). Objekt-Level-Gates (z.B. `br.status`,
 * `istEntwurf`, `ist_offen`, `quittiert_at`) bleiben am Aufrufort lokal und werden dort mit
 * `lokal && darfImEinsatzSchreiben(...)` verknüpft — NICHT in den Helfer falten.
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
