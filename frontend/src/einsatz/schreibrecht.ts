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
 * Norm: `aktiv && fuehrtHier && (EL || FüPers)` (Führung je Einsatz: LLH-1491). Die System-Rolle Admin schreibt in Modulen nur mit
 * Einsatzrolle, wie der Server (`EinsatzSchreibzugriff`, LFH-1118); ohne Rolle bleiben ihm nur die
 * Verwaltungswege der eigenen Org (`darfEinsatzVerwalten`, `darfModuleVerwalten`). Reine
 * UI-Schranke; die verbindliche Autorisierung erzwingt das Backend.
 */

/** Nur die zwei Einsatz-Felder, die die Regel braucht — `Pick` + nullable, damit
 *  Partial-Fixtures und `einsatzQuery.data?.`-Aufrufstellen ohne Cast durchlaufen. */
export type EinsatzSchreibkontext =
  Pick<EinsatzAnzeige, 'status' | 'meine_rolle' | 'fuehrung'> | null | undefined;

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

/** Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`): führt diese Instanz den Einsatz? Ohne
    Führungsakte (keine Kopplung, Schalter aus) immer. Führt eine gekoppelte Instanz, lehnt der
    Server jeden Schreibweg mit 409 ab (`fordere_aktiv`); die Schreib-UI sperrt darum mit. */
export function fuehrtHier(einsatz?: Pick<EinsatzAnzeige, 'fuehrung'> | null): boolean {
  return !einsatz?.fuehrung || einsatz.fuehrung.fuehrend;
}

/** Strikte Einsatzleitungs-Rolle — ohne aktiv-Status und OHNE Admin; für EL-Lese-Gates wie die
    Audit-Trail-Sichtbarkeit. */
export function istEinsatzLeitung(einsatz?: EinsatzSchreibkontext): boolean {
  return einsatz?.meine_rolle === 'einsatzleitung';
}

/** Leitungs-Schreibrecht: aktiver Einsatz UND Einsatzleitung — für Leitungsaktionen (Mitglieder
    verwalten, Einsatz abschließen, Abgleich entscheiden). Kein
    Admin-Zweig und darum kein Benutzer-Parameter: der Server (`EinsatzLeitungszugriff`) fragt
    allein die Einsatzrolle (LFH-1118). */
export function darfEinsatzLeiten(einsatz?: EinsatzSchreibkontext): boolean {
  return einsatz?.status === 'aktiv' && fuehrtHier(einsatz) && istEinsatzLeitung(einsatz);
}

/** Führung je Einsatz bedienen (LLH-1491): Einsatzleitung ODER System-Admin der Einsatz-Org,
    unabhängig von Status und Führung — wie der Server (`EinsatzFuehrungszugriff`): übergeben wird
    auch ein abgeschlossener Einsatz, bestätigt oder widersprochen, wenn eine andere Instanz führt. */
export function darfFuehrungBedienen(
  einsatz: EinsatzOrgKontext,
  benutzer: BenutzerOrgKontext,
): boolean {
  if (!einsatz) return false;
  if (istEinsatzLeitung(einsatz)) return true;
  return istAdmin(benutzer) && benutzer?.org_id === einsatz.org_id;
}

/** Einsatz-Kontext mit Org — nur für Rechte, deren Admin-Zweig an der Einsatz-Org hängt. Eigener
    Typ, damit die geteilten `…Schreibkontext`-Typen und ihre Fixtures unberührt bleiben. */
export type EinsatzOrgKontext =
  Pick<EinsatzAnzeige, 'status' | 'meine_rolle' | 'org_id' | 'fuehrung'> | null | undefined;

/** System-Rolle und eigene Org des Benutzers — Gegenstück zu {@link EinsatzOrgKontext}. */
export type BenutzerOrgKontext =
  Pick<BenutzerAnzeige, 'system_rolle' | 'org_id'> | null | undefined;

/** Modul-Overrides des Einsatzes verwalten (LFH-995): aktiver Einsatz UND (Einsatzleitung ODER
    System-Admin der Einsatz-Org) — wie der Server (`modul_override_setzen`). Der Admin einer
    fremden Org bekäme dort 403; die Einsatzleitung trägt auch über die Org-Grenze. */
export function darfModuleVerwalten(
  einsatz: EinsatzOrgKontext,
  benutzer: BenutzerOrgKontext,
): boolean {
  if (einsatz?.status !== 'aktiv' || !fuehrtHier(einsatz)) return false;
  if (istEinsatzLeitung(einsatz)) return true;
  return istAdmin(benutzer) && benutzer?.org_id === einsatz.org_id;
}

/** Verwaltungsangaben des Einsatzes ändern (LFH-1066): Kopfdaten, Einstellungen und
    Führungsstelle. Aktiver Einsatz UND (Einsatzleitung ODER Führungspersonal ODER System-Admin der
    Einsatz-Org) — wie der Server (`EinsatzVerwaltungszugriff`). Der Admin einer fremden Org liest
    nur; eine Mitgliedschaft trägt auch über die Org-Grenze. */
export function darfEinsatzVerwalten(
  einsatz: EinsatzOrgKontext,
  benutzer: BenutzerOrgKontext,
): boolean {
  if (einsatz?.status !== 'aktiv' || !fuehrtHier(einsatz)) return false;
  if (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal') {
    return true;
  }
  return istAdmin(benutzer) && benutzer?.org_id === einsatz.org_id;
}

/** Allgemeines Einsatz-Schreibrecht: aktiver Einsatz UND (Einsatzleitung ODER Führungspersonal)
    — die Norm für die Schreib-UI aller Einsatz-Module. Kein Admin-Zweig und darum kein
    Benutzer-Parameter: der Server (`EinsatzSchreibzugriff`) lehnt den Admin ohne Schreibrolle mit
    403 ab (LFH-1118). */
export function darfImEinsatzSchreiben(einsatz?: EinsatzSchreibkontext): boolean {
  return (
    einsatz?.status === 'aktiv' &&
    fuehrtHier(einsatz) &&
    (einsatz?.meine_rolle === 'einsatzleitung' || einsatz?.meine_rolle === 'fuehrungspersonal')
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

/**
 * Vorplanung ohne Einsatz (LLH-1561, Spec `vorplanung`): Planungen lesen und schreiben dieselben
 * Personen, die einen Einsatz anlegen dürfen (System-Admin oder org-weite Führungskraft; Server
 * `darf_einsatz_anlegen`). Ohne das Recht fehlt „Planungen“ in der Kopfleiste.
 */
export function darfPlanen(benutzer?: BenutzerVerwaltungskontext): boolean {
  return darfVerwaltung(benutzer);
}
