/**
 * Zentrale, typsichere Deeplink-/URL-Builder für den Einsatz-Workspace (LFH-25).
 *
 * Eine Quelle der Wahrheit für alle modulübergreifenden Pfade. Statt inline
 * Template-Literals (`/einsaetze/${id}/...`) über die Codebasis verstreut bauen
 * Komponenten ihre Links hierüber — das hält die Routen-Strings, die Param-Namen
 * und die Query-Konventionen an EINER Stelle und macht sie unit-testbar.
 *
 * Muster (siehe docs/superpowers/specs/2026-06-23-deeplinks-vereinheitlichen-design.md
 * und die UI-Form-Leitlinie in CLAUDE.md):
 *  - **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` → Vollseiten-Detail (uhs, br,
 *    lagebericht, befehl, person).
 *  - **Query-Param** `?<modul>=<id>` → Selektion/Drawer auf der Listenseite, wenn das
 *    Modul (noch) keine eigene Detail-Route hat (schaden, einheit, fahrzeug, personal,
 *    abschnitt, meldung, auftrag) bzw. ein Eintrag in einer Liste adressiert wird (etb).
 *  - **`?neu=1`** → Schnellerfassung auf der Listenseite fokussieren.
 *
 * Die Builder sind reine String-Funktionen und gehen von gültigen, positiven
 * Integer-IDs aus. ID-Validierung von URL-Parametern macht `parseRouteId`; Link-Render-
 * Stellen mit potenziell fehlender ID guarden vor dem Aufruf (kein doppelter Guard im
 * Builder).
 */

/** Basis-Pfad eines Einsatz-Moduls: `/einsaetze/<einsatzId>/<modulRoute>`. */
export function einsatzModulPfad(einsatzId: number, modulRoute: string): string {
  return `/einsaetze/${einsatzId}/${modulRoute}`;
}

function mitQuery(pfad: string, params: Record<string, string | number | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return qs ? `${pfad}?${qs}` : pfad;
}

// ── Item-Routes (Vollseiten-Detail) ──────────────────────────────────────────

export function uhsDetailPfad(einsatzId: number, uhsId: number): string {
  return `${einsatzModulPfad(einsatzId, 'unfallhilfsstellen')}/${uhsId}`;
}

export function bereitstellungsraumDetailPfad(einsatzId: number, brId: number): string {
  return `${einsatzModulPfad(einsatzId, 'bereitstellungsraeume')}/${brId}`;
}

export function lageberichtDetailPfad(einsatzId: number, lageberichtId: number): string {
  return `${einsatzModulPfad(einsatzId, 'lageberichte')}/${lageberichtId}`;
}

export function befehlDetailPfad(einsatzId: number, befehlId: number): string {
  return `${einsatzModulPfad(einsatzId, 'auftraege')}/befehle/${befehlId}`;
}

export function personDetailPfad(einsatzId: number, personId: number): string {
  return `${einsatzModulPfad(einsatzId, 'personen')}/${personId}`;
}

// ── Listen-Routes (auch NaN-Redirect-Ziele) ──────────────────────────────────

export function unfallhilfsstellenListePfad(einsatzId: number): string {
  return `${einsatzModulPfad(einsatzId, 'unfallhilfsstellen')}/liste`;
}

export function bereitstellungsraeumePfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'bereitstellungsraeume');
}

export function lageberichtePfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'lageberichte');
}

export function einsatzdatenPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'einsatzdaten');
}

// ── Listen mit Query-Selektion / Schnellerfassung ────────────────────────────

export function personenPfad(
  einsatzId: number,
  opts: { person?: number; neu?: boolean } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'personen'), {
    person: opts.person,
    neu: opts.neu ? 1 : undefined,
  });
}

export function schaedenPfad(
  einsatzId: number,
  opts: { schaden?: number; neu?: boolean } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'schaeden'), {
    schaden: opts.schaden,
    neu: opts.neu ? 1 : undefined,
  });
}

export function etbPfad(
  einsatzId: number,
  opts: { eintrag?: number; neu?: boolean } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'etb'), {
    eintrag: opts.eintrag,
    neu: opts.neu ? 1 : undefined,
  });
}

export function personalPfad(einsatzId: number, opts: { personal?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'personal'), { personal: opts.personal });
}

export function einheitenPfad(einsatzId: number, opts: { einheit?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'einheiten'), { einheit: opts.einheit });
}

export function fahrzeugePfad(einsatzId: number, opts: { fahrzeug?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'fahrzeuge'), { fahrzeug: opts.fahrzeug });
}

export function einsatzabschnittePfad(einsatzId: number, opts: { abschnitt?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'einsatzabschnitte'), { abschnitt: opts.abschnitt });
}

export function meldungenPfad(einsatzId: number, opts: { meldung?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'meldungen'), { meldung: opts.meldung });
}

export function auftraegePfad(einsatzId: number, opts: { auftrag?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'auftraege'), { auftrag: opts.auftrag });
}

// ── Route-Param-Robustheit ───────────────────────────────────────────────────

/**
 * Parst einen URL-Route-Parameter zu einer gültigen Entitäts-ID oder `null`.
 * Strenger als nur `Number.isNaN`: akzeptiert ausschließlich positive Ganzzahlen
 * (fängt zusätzlich `''` → 0, Dezimal-, Negativ- und Nicht-Zahl-Werte ab).
 * Backend-Entitäts-IDs sind immer > 0, daher ist `<= 0` ebenfalls ungültig.
 */
export function parseRouteId(param: string | undefined): number | null {
  if (param == null || param.trim() === '') return null;
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}
