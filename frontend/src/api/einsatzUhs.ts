import type {
  Uhs, UhsDetail, UhsPlatz, UhsBelegung,
  UhsTyp, UhsStatus, PlatzTyp, Verfuegbarkeit, BelegungsArt,
} from './types';
import { apiGet, apiSend } from './client';

// ---------- UHS ----------

export function listeUhs(einsatzId: number, status?: UhsStatus, abschnittId?: number): Promise<Uhs[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (abschnittId != null) params.set('abschnitt_id', String(abschnittId));
  const q = params.toString();
  return apiGet<Uhs[]>(`/api/einsaetze/${einsatzId}/uhs${q ? '?' + q : ''}`);
}

export function ladeUhs(einsatzId: number, uhsId: number): Promise<UhsDetail> {
  return apiGet<UhsDetail>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}`);
}

export interface UhsEingabe {
  typ: UhsTyp;
  bezeichnung: string;
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
}

export function legeUhsAn(einsatzId: number, daten: UhsEingabe): Promise<Uhs> {
  return apiSend<Uhs>(`/api/einsaetze/${einsatzId}/uhs`, 'POST', daten);
}

export interface UhsPatch {
  bezeichnung?: string;
  /** `null` = explizit löschen, undefined = unverändert. */
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
}

export function aktualisiereUhs(einsatzId: number, uhsId: number, daten: UhsPatch): Promise<Uhs> {
  return apiSend<Uhs>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}`, 'PATCH', daten);
}

export function setzeUhsStatus(einsatzId: number, uhsId: number, status: UhsStatus): Promise<Uhs> {
  return apiSend<Uhs>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}/status`, 'POST', { status });
}

export function storniereUhs(einsatzId: number, uhsId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}`, 'DELETE');
}

// ---------- Plätze ----------

export interface PlatzEingabe {
  typ: PlatzTyp;
  bezeichnung: string;
  pos_x?: number | null;
  pos_y?: number | null;
}

export function legePlatzAn(einsatzId: number, uhsId: number, daten: PlatzEingabe): Promise<UhsPlatz> {
  return apiSend<UhsPlatz>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze`, 'POST', daten);
}

export interface PlatzPatch {
  bezeichnung?: string;
  pos_x?: number | null;
  pos_y?: number | null;
}

export function aktualisierePlatz(
  einsatzId: number, uhsId: number, platzId: number, daten: PlatzPatch,
): Promise<UhsPlatz> {
  return apiSend<UhsPlatz>(
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/${platzId}`,
    'PATCH', daten,
  );
}

export function setzePlatzVerfuegbarkeit(
  einsatzId: number, uhsId: number, platzId: number,
  verfuegbarkeit: Verfuegbarkeit, reserviertFuerPersonId?: number | null,
): Promise<UhsPlatz> {
  return apiSend<UhsPlatz>(
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/${platzId}/verfuegbarkeit`,
    'POST', { verfuegbarkeit, reserviert_fuer_person_id: reserviertFuerPersonId ?? null },
  );
}

export function stornierePlatz(einsatzId: number, uhsId: number, platzId: number): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/${platzId}`, 'DELETE',
  );
}

// ---------- Belegung ----------

export interface BelegungEingabe {
  art: BelegungsArt;
  uhs_id?: number;        // erforderlich bei eintritt/wechsel
  platz_id?: number | null;
  notiz?: string | null;
}

export function aenderePersonBelegung(
  einsatzId: number, personId: number, daten: BelegungEingabe,
): Promise<UhsBelegung> {
  return apiSend<UhsBelegung>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/uhs-belegung`,
    'POST', daten,
  );
}
