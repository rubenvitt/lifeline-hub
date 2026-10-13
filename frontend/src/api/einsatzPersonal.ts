import type { EinsatzPersonal, FuehrungskraftKarte, StaerkePosition } from './types';
import { apiGet, apiSend } from './client';
import type { PositionPatch } from './einheiten';

export interface AdhocEingabe {
  name: string;
  funktion?: string | null;
  traegerorganisation?: string | null;
  staerke_position?: StaerkePosition | null;
}

export function listeEinsatzPersonal(einsatzId: number): Promise<EinsatzPersonal[]> {
  return apiGet<EinsatzPersonal[]>(`/api/einsaetze/${einsatzId}/personal`);
}

export function disponierePerson(
  einsatzId: number,
  personalId: number,
  staerkePosition?: StaerkePosition | null,
): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal`, 'POST', {
    personal_id: personalId,
    staerke_position: staerkePosition ?? null,
  });
}

export function disponiereAdhoc(einsatzId: number, adhoc: AdhocEingabe): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal`, 'POST', { adhoc });
}

export function aktualisiereDisposition(
  einsatzId: number,
  epId: number,
  felder: { status_id?: number; staerke_position?: StaerkePosition | null; bemerkung?: string },
): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal/${epId}`, 'PATCH', felder);
}

/** Entlassene Kräfte des Einsatzes (LLH-1079, Block „Entlassen“); Stornierte liefert keine Liste. */
export function listEntlassenesPersonal(einsatzId: number): Promise<EinsatzPersonal[]> {
  return apiGet<EinsatzPersonal[]>(`/api/einsaetze/${einsatzId}/personal?entlassene=1`);
}

/**
 * Aus dem Einsatz entlassen (LLH-1079): die Zeile bleibt mit ihrer Zeitachse, Bindungen gehen.
 * Umkehrbar über {@link reaktiviereDisposition}, deshalb ohne Rückfrage.
 */
export function entlasseDisposition(einsatzId: number, epId: number): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal/${epId}/entlassen`, 'POST');
}

/** Fehldisposition stornieren (LLH-1079): nur ohne Bindung und Spur in den ersten 15 Minuten. */
export function storniereDisposition(einsatzId: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/personal/${epId}/stornieren`, 'POST');
}

/** Eine entlassene oder stornierte Kraft erneut disponieren (Rückgängig, Block „Entlassen“). */
export function reaktiviereDisposition(einsatzId: number, epId: number): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(
    `/api/einsaetze/${einsatzId}/personal/${epId}/reaktivieren`,
    'POST',
  );
}

/** L‑2: Lädt die Führungskräfte-Marker für die Lagekarte. */
export function listeFuehrungskraefte(einsatzId: number): Promise<FuehrungskraftKarte[]> {
  return apiGet<FuehrungskraftKarte[]>(`/api/einsaetze/${einsatzId}/karte/fuehrungskraefte`);
}

/** L‑2: Verortet eine Führungskraft (Einsatzpersonal) auf der Lagekarte. */
export function verortePerson(
  einsatzId: number,
  epId: number,
  daten: PositionPatch,
): Promise<FuehrungskraftKarte> {
  return apiSend<FuehrungskraftKarte>(
    `/api/einsaetze/${einsatzId}/personal/${epId}/position`,
    'PATCH',
    daten,
  );
}
