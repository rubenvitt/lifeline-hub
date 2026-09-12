import type {
  Bereitstellungsraum,
  BrDetail,
  BrBelegung,
  BrStatus,
  ObjektTyp,
  BrBelegungsArt,
} from './types';
import { apiGet, apiSend } from './client';

// ---------- Bereitstellungsräume ----------

export function listeBr(
  einsatzId: number,
  status?: BrStatus,
  abschnittId?: number,
): Promise<Bereitstellungsraum[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (abschnittId != null) params.set('abschnitt_id', String(abschnittId));
  const q = params.toString();
  return apiGet<Bereitstellungsraum[]>(
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume${q ? '?' + q : ''}`,
  );
}

export function ladeBr(einsatzId: number, brId: number): Promise<BrDetail> {
  return apiGet<BrDetail>(`/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}`);
}

export interface BrEingabe {
  bezeichnung: string;
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
}

export function legeBrAn(einsatzId: number, daten: BrEingabe): Promise<Bereitstellungsraum> {
  return apiSend<Bereitstellungsraum>(
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume`,
    'POST',
    daten,
  );
}

export interface BrPatch {
  bezeichnung?: string;
  /** `null` = explizit löschen, undefined = unverändert. */
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
}

export function aktualisiereBr(
  einsatzId: number,
  brId: number,
  daten: BrPatch,
): Promise<Bereitstellungsraum> {
  return apiSend<Bereitstellungsraum>(
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}`,
    'PATCH',
    daten,
  );
}

export function setzeBrStatus(
  einsatzId: number,
  brId: number,
  status: BrStatus,
): Promise<Bereitstellungsraum> {
  return apiSend<Bereitstellungsraum>(
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}/status`,
    'POST',
    { status },
  );
}

export function storniereBr(einsatzId: number, brId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}`, 'DELETE');
}

export interface BrBelegungEingabe {
  objekt_typ: ObjektTyp;
  objekt_id: number;
  art: BrBelegungsArt;
  notiz?: string | null;
}

export function belegeBr(
  einsatzId: number,
  brId: number,
  daten: BrBelegungEingabe,
): Promise<BrBelegung> {
  return apiSend<BrBelegung>(
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}/belegung`,
    'POST',
    daten,
  );
}
