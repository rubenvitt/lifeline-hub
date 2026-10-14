import type { EinsatzFahrzeug } from './types';
import { apiGet, apiSend } from './client';
import type { PositionPatch } from './einheiten';

export interface AdhocEingabe {
  funkrufname: string;
  fahrzeugtyp?: string | null;
  kennzeichen?: string | null;
  opta?: string | null;
  traegerorganisation?: string | null;
}

export function listeEinsatzFahrzeuge(einsatzId: number): Promise<EinsatzFahrzeug[]> {
  return apiGet<EinsatzFahrzeug[]>(`/api/einsaetze/${einsatzId}/fahrzeuge`);
}

/** Auswahl und Ziel-Einheit einer Sammel-Disposition (LLH-1100). */
export interface SammelFahrzeugEingabe {
  fahrzeug_ids: number[];
  einheit_id?: number | null;
}

/**
 * Mehrere Stamm-Fahrzeuge in einem Schritt disponieren, optional in eine Einheit (LLH-1100):
 * alles oder nichts. Eine Ablehnung trägt die Gründe je Fahrzeug in `ApiError.zeilen`.
 */
export function disponiereFahrzeugeSammel(
  einsatzId: number,
  eingabe: SammelFahrzeugEingabe,
): Promise<EinsatzFahrzeug[]> {
  return apiSend<EinsatzFahrzeug[]>(`/api/einsaetze/${einsatzId}/fahrzeuge/sammel`, 'POST', {
    fahrzeug_ids: eingabe.fahrzeug_ids,
    einheit_id: eingabe.einheit_id ?? null,
  });
}

export function disponiereAdhoc(einsatzId: number, adhoc: AdhocEingabe): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/einsaetze/${einsatzId}/fahrzeuge`, 'POST', { adhoc });
}

/**
 * Angaben eines Ad-hoc-Fahrzeugs im Teil-Patch (LLH-1073, design.md D1): fehlender Key =
 * unverändert, `null` = leeren; der Funkrufname ist Pflicht und nie `null`. Bei einem
 * Stamm-Fahrzeug antwortet der Server mit 422 („im Stamm pflegen“).
 */
export interface AngabenPatch {
  funkrufname?: string;
  fahrzeugtyp?: string | null;
  kennzeichen?: string | null;
  traegerorganisation?: string | null;
  opta?: string | null;
}

/** Der Zeilen-PATCH einer Disposition: Status, Bemerkung und die Ad-hoc-Angaben. */
export type DispositionPatch = AngabenPatch & { status_id?: number; bemerkung?: string | null };

export function updateDisposition(
  einsatzId: number,
  efId: number,
  felder: DispositionPatch,
): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/einsaetze/${einsatzId}/fahrzeuge/${efId}`, 'PATCH', felder);
}

/** Entlassene Fahrzeuge des Einsatzes (LLH-1079 Teil II, Block „Entlassen“). */
export function listEntlasseneFahrzeuge(einsatzId: number): Promise<EinsatzFahrzeug[]> {
  return apiGet<EinsatzFahrzeug[]>(`/api/einsaetze/${einsatzId}/fahrzeuge?entlassene=1`);
}

/**
 * Aus dem Einsatz entlassen (LLH-1079): die Zeile bleibt, Besatzung, Einheit,
 * Bereitstellungsraum und Führungsstelle gehen. Umkehrbar über {@link reaktiviereDisposition},
 * deshalb ohne Rückfrage.
 */
export function entlasseDisposition(einsatzId: number, efId: number): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(
    `/api/einsaetze/${einsatzId}/fahrzeuge/${efId}/entlassen`,
    'POST',
  );
}

/** Fehldisposition stornieren (LLH-1079): nur ohne Spur in den ersten 15 Minuten. */
export function storniereDisposition(einsatzId: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/fahrzeuge/${efId}/stornieren`, 'POST');
}

/** Ein entlassenes oder storniertes Fahrzeug erneut disponieren (Rückgängig, Block „Entlassen“). */
export function reaktiviereDisposition(einsatzId: number, efId: number): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(
    `/api/einsaetze/${einsatzId}/fahrzeuge/${efId}/reaktivieren`,
    'POST',
  );
}

/** L‑2: Verortet ein Einsatzfahrzeug auf der Lagekarte. */
export function verorteFahrzeug(
  einsatzId: number,
  efId: number,
  daten: PositionPatch,
): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(
    `/api/einsaetze/${einsatzId}/fahrzeuge/${efId}/position`,
    'PATCH',
    daten,
  );
}

/** LFH-9: Ordnet eine Kraft (einsatz_personal.id) einem Fahrzeug als Besatzung zu. */
export function ordneBesatzungZu(einsatzId: number, efId: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/fahrzeuge/${efId}/besatzung/${epId}`, 'PUT');
}

/** LFH-9: Gibt eine Kraft aus der Fahrzeug-Besatzung frei. */
export function gibBesatzungFrei(einsatzId: number, efId: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/fahrzeuge/${efId}/besatzung/${epId}`, 'DELETE');
}
