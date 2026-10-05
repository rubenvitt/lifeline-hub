import type {
  Uhs,
  UhsDetail,
  UhsPlatz,
  UhsBelegung,
  UhsTyp,
  UhsStatus,
  PlatzTyp,
  Verfuegbarkeit,
  BelegungsArt,
  UhsAnhang,
  AnhangZugriff,
} from './types';
import {
  apiGet,
  apiSend,
  apiUploadMitFortschritt,
  mitParametern,
  type UploadFortschritt,
} from './client';
import { UPLOAD_TIMEOUT_MS } from './upload';

// ---------- UHS ----------

export function listeUhs(
  einsatzId: number,
  status?: UhsStatus,
  abschnittId?: number,
): Promise<Uhs[]> {
  return apiGet<Uhs[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/uhs`, { status, abschnitt_id: abschnittId }),
  );
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

interface UhsPatch {
  bezeichnung?: string;
  /** `null` = explizit löschen, undefined = unverändert. */
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
  /** lat/lon werden gemeinsam gesendet (beide Zahl = setzen, beide null = löschen). */
  lat?: number | null;
  lon?: number | null;
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

interface PlatzBulkEingabe {
  typ: PlatzTyp;
  menge: number;
}

/** Legt mehrere Plätze eines Typs an; Bezeichnungen werden server-seitig
 *  automatisch fortlaufend vergeben (LFH-16). */
export function legePlaetzeAn(
  einsatzId: number,
  uhsId: number,
  daten: PlatzBulkEingabe,
): Promise<UhsPlatz[]> {
  return apiSend<UhsPlatz[]>(
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/bulk`,
    'POST',
    daten,
  );
}

interface PlatzPatch {
  bezeichnung?: string;
  pos_x?: number | null;
  pos_y?: number | null;
}

export function aktualisierePlatz(
  einsatzId: number,
  uhsId: number,
  platzId: number,
  daten: PlatzPatch,
): Promise<UhsPlatz> {
  return apiSend<UhsPlatz>(
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/${platzId}`,
    'PATCH',
    daten,
  );
}

export function setzePlatzVerfuegbarkeit(
  einsatzId: number,
  uhsId: number,
  platzId: number,
  verfuegbarkeit: Verfuegbarkeit,
  reserviertFuerPersonId?: number | null,
): Promise<UhsPlatz> {
  return apiSend<UhsPlatz>(
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/${platzId}/verfuegbarkeit`,
    'POST',
    { verfuegbarkeit, reserviert_fuer_person_id: reserviertFuerPersonId ?? null },
  );
}

export function stornierePlatz(einsatzId: number, uhsId: number, platzId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/${platzId}`, 'DELETE');
}

// ---------- Belegung ----------

interface BelegungEingabe {
  art: BelegungsArt;
  uhs_id?: number; // erforderlich bei eintritt/wechsel
  platz_id?: number | null;
  notiz?: string | null;
}

export function aenderePersonBelegung(
  einsatzId: number,
  personId: number,
  daten: BelegungEingabe,
): Promise<UhsBelegung> {
  return apiSend<UhsBelegung>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/uhs-belegung`,
    'POST',
    daten,
  );
}

// ---------- Fotos, Pläne und Dateien (LFH-758) ----------

const anhangBasis = (einsatzId: number, uhsId: number) =>
  `/api/einsaetze/${einsatzId}/uhs/${uhsId}/anhaenge`;

/** Lebende Anhänge einer UHS, neueste zuerst. Die Liste selbst wird nicht protokolliert. */
export function listeUhsAnhaenge(einsatzId: number, uhsId: number): Promise<UhsAnhang[]> {
  return apiGet<UhsAnhang[]>(anhangBasis(einsatzId, uhsId));
}

/** Legt EINE Datei an der UHS ab (Feld `datei`); Timeout und Fortschritt wie die übrigen Uploads. */
export function legeUhsAnhangAb(
  einsatzId: number,
  uhsId: number,
  datei: File,
  onFortschritt?: (stand: UploadFortschritt) => void,
): Promise<UhsAnhang> {
  const fd = new FormData();
  fd.append('datei', datei);
  return apiUploadMitFortschritt<UhsAnhang>(anhangBasis(einsatzId, uhsId), fd, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    onFortschritt,
  });
}

/** Entfernt einen Anhang (Soft-Delete mit ETB-Nachweis); `anhangId` ist die Linker-id. */
export function entferneUhsAnhang(
  einsatzId: number,
  uhsId: number,
  anhangId: number,
): Promise<void> {
  return apiSend<void>(`${anhangBasis(einsatzId, uhsId)}/${anhangId}`, 'DELETE');
}

/**
 * Download über die modul-gegatete UHS-Route; **jeder Abruf steht im Zugriffsprotokoll** (auch
 * ein 304). Ein API-Pfad, keine Navigation, deshalb nicht in `routing/deeplinks.ts`.
 */
export function uhsAnhangDownloadPfad(einsatzId: number, uhsId: number, anhangId: number): string {
  return `${anhangBasis(einsatzId, uhsId)}/${anhangId}/datei`;
}

/** Zugriffsprotokoll der Dateien einer UHS, neueste zuerst — nur für die Einsatzleitung (sonst
 *  403). Die Einsicht selbst wird nicht protokolliert. */
export function ladeUhsAnhangZugriffe(einsatzId: number, uhsId: number): Promise<AnhangZugriff[]> {
  return apiGet<AnhangZugriff[]>(`${anhangBasis(einsatzId, uhsId)}/zugriffe`);
}
