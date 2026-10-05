import { apiGet, apiSend } from './client';
import type {
  Fernmeldeskizze,
  Komponentenart,
  Schriftfeld,
  SkizzenBereich,
  SkizzenBezug,
  SkizzenKomponente,
  SkizzenLage,
  SkizzenVerbindung,
  Verbindungsart,
  Verbindungsmedium,
  Verbindungsstatus,
  Verkehrsart,
} from './types';

/**
 * Client der taktischen Fernmeldeskizze (LFH-893). Vertrag:
 * `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md` (D5, D14).
 *
 * - **Skizzendaten** (Lage, Schriftfeld, Komponenten, Verbindungen, Bereiche) unter
 *   `…/stab/fernmeldeskizze`, Recht des Stabs, Live über das `stab`-Ereignis.
 * - **Einzel-Zuordnungen** (D5): eine Sprechgruppe an genau EINEN Datensatz setzen oder davon
 *   lösen, idempotent, am Pfad des Datensatzes und mit dessen Recht. Der PATCH mit
 *   `sprechgruppe_ids` (ganze Menge) bleibt den Formularen.
 * - Eine abweichende Version (Lage, Bereich) antwortet 409; der Fehler kommt als `ApiError`
 *   zurück, den gespeicherten Stand holt der Aufrufer mit dem nächsten Abruf.
 */

function einsatz(einsatzId: number): string {
  return `/api/einsaetze/${einsatzId}`;
}

function skizze(einsatzId: number): string {
  return `${einsatz(einsatzId)}/stab/fernmeldeskizze`;
}

export function ladeFernmeldeskizze(einsatzId: number): Promise<Fernmeldeskizze> {
  return apiGet<Fernmeldeskizze>(skizze(einsatzId));
}

// ── Lage (D4) ──────────────────────────────────────────────────────────────────────────────────

export interface SkizzenLageEingabe {
  x: number;
  y: number;
  /** Nur bei Schienen; fehlt = unverändert, `null` = leeren. */
  breite?: number | null;
  /** Der zuletzt bekannte Stand; `null` = noch keine Zeile erwartet. Pflicht. */
  version: number | null;
}

/** `element`: `fs`, `ab-<id>`, `eh-<id>`, `ks-<id>`, `ko-<id>` oder `sg-<id>`. */
export function setzeSkizzenLage(
  einsatzId: number,
  element: string,
  eingabe: SkizzenLageEingabe,
): Promise<SkizzenLage> {
  return apiSend<SkizzenLage>(
    `${skizze(einsatzId)}/lage/${encodeURIComponent(element)}`,
    'PUT',
    eingabe,
  );
}

/**
 * Die Lage EINES Elements verwerfen (Rückgängig des ersten Verschiebens, Review O3): mit
 * erwarteter `version`, 409 bei Abweichung, ohne Zeile 204 ohne Wirkung.
 */
export function entferneSkizzenLage(
  einsatzId: number,
  element: string,
  version: number,
): Promise<void> {
  return apiSend<void>(`${skizze(einsatzId)}/lage/${encodeURIComponent(element)}`, 'DELETE', {
    version,
  });
}

/** „Neu anordnen“: alle Lagen des Einsatzes verwerfen, Zuordnungen bleiben. */
export function verwerfeSkizzenLage(einsatzId: number): Promise<void> {
  return apiSend<void>(`${skizze(einsatzId)}/lage`, 'DELETE');
}

// ── Schriftfeld (D13) ──────────────────────────────────────────────────────────────────────────

/** Tri-State: fehlender Schlüssel = unverändert, `null` = leeren (`vs_vermerk` nie `null`). */
export type SchriftfeldPatch = Partial<Schriftfeld>;

export function setzeSchriftfeld(einsatzId: number, patch: SchriftfeldPatch): Promise<Schriftfeld> {
  return apiSend<Schriftfeld>(`${skizze(einsatzId)}/schriftfeld`, 'PUT', patch);
}

// ── Komponenten ────────────────────────────────────────────────────────────────────────────────

export interface NeueKomponente {
  art: Komponentenart;
  bezeichnung?: string | null;
}

export interface KomponentePatch {
  art?: Komponentenart;
  /** `null` leert. */
  bezeichnung?: string | null;
}

export function legeKomponenteAn(
  einsatzId: number,
  eingabe: NeueKomponente,
): Promise<SkizzenKomponente> {
  return apiSend<SkizzenKomponente>(`${skizze(einsatzId)}/komponenten`, 'POST', eingabe);
}

export function aendereKomponente(
  einsatzId: number,
  komponenteId: number,
  patch: KomponentePatch,
): Promise<SkizzenKomponente> {
  return apiSend<SkizzenKomponente>(
    `${skizze(einsatzId)}/komponenten/${komponenteId}`,
    'PATCH',
    patch,
  );
}

/** Samt Kanälen, Lage und Verbindungen der Komponente. */
export function entferneKomponente(einsatzId: number, komponenteId: number): Promise<void> {
  return apiSend<void>(`${skizze(einsatzId)}/komponenten/${komponenteId}`, 'DELETE');
}

// ── Punkt-zu-Punkt-Verbindungen (D3) ───────────────────────────────────────────────────────────

/** Keine Rufnummer: Erreichbarkeit steht im Kommunikationsplan (D3). */
export interface NeueSkizzenVerbindung {
  von: SkizzenBezug;
  nach: SkizzenBezug;
  art: Verbindungsart;
  medium: Verbindungsmedium;
  status: Verbindungsstatus;
  verkehr?: Verkehrsart | null;
  hinweis?: string | null;
}

/** Ohne Endpunkte; `verkehr`/`hinweis` tri-state. */
export type SkizzenVerbindungPatch = Partial<Omit<NeueSkizzenVerbindung, 'von' | 'nach'>>;

export function legeSkizzenVerbindungAn(
  einsatzId: number,
  eingabe: NeueSkizzenVerbindung,
): Promise<SkizzenVerbindung> {
  return apiSend<SkizzenVerbindung>(`${skizze(einsatzId)}/verbindungen`, 'POST', eingabe);
}

export function aendereSkizzenVerbindung(
  einsatzId: number,
  verbindungId: number,
  patch: SkizzenVerbindungPatch,
): Promise<SkizzenVerbindung> {
  return apiSend<SkizzenVerbindung>(
    `${skizze(einsatzId)}/verbindungen/${verbindungId}`,
    'PATCH',
    patch,
  );
}

export function entferneSkizzenVerbindung(einsatzId: number, verbindungId: number): Promise<void> {
  return apiSend<void>(`${skizze(einsatzId)}/verbindungen/${verbindungId}`, 'DELETE');
}

// ── Bereiche ───────────────────────────────────────────────────────────────────────────────────

export interface NeuerBereich {
  /** Fehlt sie, gilt „Rückwärtiger Bereich“. */
  bezeichnung?: string;
  x: number;
  y: number;
  breite: number;
  hoehe: number;
}

export interface BereichPatch {
  bezeichnung?: string;
  x?: number;
  y?: number;
  breite?: number;
  hoehe?: number;
  /** Der zuletzt bekannte Stand; 409 bei Abweichung. */
  version: number;
}

export function legeBereichAn(einsatzId: number, eingabe: NeuerBereich): Promise<SkizzenBereich> {
  return apiSend<SkizzenBereich>(`${skizze(einsatzId)}/bereiche`, 'POST', eingabe);
}

export function aendereBereich(
  einsatzId: number,
  bereichId: number,
  patch: BereichPatch,
): Promise<SkizzenBereich> {
  return apiSend<SkizzenBereich>(`${skizze(einsatzId)}/bereiche/${bereichId}`, 'PATCH', patch);
}

export function entferneBereich(einsatzId: number, bereichId: number): Promise<void> {
  return apiSend<void>(`${skizze(einsatzId)}/bereiche/${bereichId}`, 'DELETE');
}

// ── Einzel-Zuordnungen (D5) ────────────────────────────────────────────────────────────────────

/** Der Datensatz, an dem eine Sprechgruppe hängt; die Führungsstelle gibt es je Einsatz einmal. */
export type ZuordnungsZiel =
  | { art: 'abschnitt' | 'einheit' | 'stelle' | 'komponente'; id: number }
  | { art: 'fuehrungsstelle' };

function zuordnungsPfad(einsatzId: number, ziel: ZuordnungsZiel, sprechgruppeId: number): string {
  const e = einsatz(einsatzId);
  const sg = `sprechgruppen/${sprechgruppeId}`;
  switch (ziel.art) {
    case 'abschnitt':
      return `${e}/abschnitte/${ziel.id}/${sg}`;
    case 'einheit':
      return `${e}/einheiten/${ziel.id}/${sg}`;
    case 'fuehrungsstelle':
      return `${e}/fuehrungsstelle/${sg}`;
    case 'stelle':
      return `${e}/stab/kommunikationsplan/stellen/${ziel.id}/${sg}`;
    case 'komponente':
      return `${skizze(einsatzId)}/komponenten/${ziel.id}/${sg}`;
  }
}

/**
 * Eine Sprechgruppe zuordnen (idempotent). Nur die externe Stelle trägt einen Status (D7); ohne
 * Angabe ist sie bestehend. An allen anderen Zielen gibt es keinen Body.
 */
export function ordneSprechgruppeZu(
  einsatzId: number,
  ziel: ZuordnungsZiel,
  sprechgruppeId: number,
  status?: Verbindungsstatus,
): Promise<void> {
  const pfad = zuordnungsPfad(einsatzId, ziel, sprechgruppeId);
  return ziel.art === 'stelle'
    ? apiSend<void>(pfad, 'PUT', { status: status ?? 'bestehend' })
    : apiSend<void>(pfad, 'PUT');
}

/** Eine Zuordnung lösen (idempotent). */
export function loeseSprechgruppe(
  einsatzId: number,
  ziel: ZuordnungsZiel,
  sprechgruppeId: number,
): Promise<void> {
  return apiSend<void>(zuordnungsPfad(einsatzId, ziel, sprechgruppeId), 'DELETE');
}
