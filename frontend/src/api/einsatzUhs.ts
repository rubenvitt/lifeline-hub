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
  UhsKraft,
  UhsBelegungRuecknahme,
  StaerkePosition,
  QualiSollEingabe,
} from './types';
import {
  apiGet,
  apiSend,
  apiUploadMitFortschritt,
  mitParametern,
  type UploadFortschritt,
} from './client';
import { UPLOAD_TIMEOUT_MS } from './upload';
import { zuruecknahmeQuery, type ZuruecknahmeFilter } from './einheiten';

// ---------- UHS ----------

export function listeUhs(
  einsatzId: number,
  status?: UhsStatus,
  abschnittId?: number,
): Promise<Uhs[]> {
  return apiGet<Uhs[]>(
    mitParametern(`/api/incidents/${einsatzId}/uhs`, { status, abschnitt_id: abschnittId }),
  );
}

export function ladeUhs(einsatzId: number, uhsId: number): Promise<UhsDetail> {
  return apiGet<UhsDetail>(`/api/incidents/${einsatzId}/uhs/${uhsId}`);
}

// ---------- Kräfte der UHS (LFH-1045) ----------

/** Einsatzkräfte ohne UHS: die Auswahl beim Zuordnen. */
export function listeKraefteOhneUhs(einsatzId: number, uhsId: number): Promise<UhsKraft[]> {
  return apiGet<UhsKraft[]>(`/api/incidents/${einsatzId}/uhs/${uhsId}/forces/available`);
}

/**
 * Kraft der UHS zuordnen. Das Rückgängig nach „Abziehen“ schickt `nurWennFrei` (LLH-1924): steht
 * sie inzwischen an einer anderen UHS, 409 statt Wechsel.
 */
export function ordneKraftZu(
  einsatzId: number,
  uhsId: number,
  kraftId: number,
  optionen?: Pick<ZuruecknahmeFilter, 'nurWennFrei'>,
): Promise<UhsKraft> {
  return apiSend<UhsKraft>(
    `/api/incidents/${einsatzId}/uhs/${uhsId}/forces/${kraftId}${zuruecknahmeQuery(optionen)}`,
    'PUT',
  );
}

export interface AdhocKraftEingabe {
  name: string;
  funktion?: string;
  staerke_position?: StaerkePosition;
}

/** Ad-hoc-Kraft disponieren und der UHS zuordnen. */
export function erfasseAdhocKraft(
  einsatzId: number,
  uhsId: number,
  daten: AdhocKraftEingabe,
): Promise<UhsKraft> {
  return apiSend<UhsKraft>(`/api/incidents/${einsatzId}/uhs/${uhsId}/forces`, 'POST', daten);
}

/** Kraft von der UHS abziehen; sie bleibt im Einsatz. */
export function zieheKraftAb(einsatzId: number, uhsId: number, kraftId: number): Promise<void> {
  return apiSend<void>(`/api/incidents/${einsatzId}/uhs/${uhsId}/forces/${kraftId}`, 'DELETE');
}

/** Alle Kräfte einer Einheit ohne UHS zuordnen (nur Einsatzleitung, kein Gerät). */
export function ordneEinheitZu(
  einsatzId: number,
  uhsId: number,
  einheitId: number,
): Promise<UhsKraft[]> {
  return apiSend<UhsKraft[]>(
    `/api/incidents/${einsatzId}/uhs/${uhsId}/forces/unit/${einheitId}`,
    'PUT',
  );
}

export interface UhsEingabe {
  typ: UhsTyp;
  bezeichnung: string;
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
  /** Koordinate aus dem Ortsfeld (LLH-1114): beide oder keine, sonst 422. */
  lat?: number | null;
  lon?: number | null;
}

export function legeUhsAn(einsatzId: number, daten: UhsEingabe): Promise<Uhs> {
  return apiSend<Uhs>(`/api/incidents/${einsatzId}/uhs`, 'POST', daten);
}

export interface UhsPatch {
  bezeichnung?: string;
  /** `null` = explizit löschen, undefined = unverändert. */
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
  /** lat/lon werden gemeinsam gesendet (beide Zahl = setzen, beide null = löschen). */
  lat?: number | null;
  lon?: number | null;
  /** LLH-1553: Soll-Anzahl der Kräfte, `null` = keins. */
  soll_anzahl?: number | null;
  /** LLH-1553: Qualifikationssoll, `[]` oder `null` = keins. */
  quali_soll?: QualiSollEingabe[] | null;
  /**
   * Optimistisches Lock (LLH-1920): `geaendert_at` beim Öffnen; ein anderer Stand gibt 409. Fehlt
   * er, schreibt der Server ohne Prüfung.
   */
  basis_geaendert_at?: string;
}

export function aktualisiereUhs(einsatzId: number, uhsId: number, daten: UhsPatch): Promise<Uhs> {
  return apiSend<Uhs>(`/api/incidents/${einsatzId}/uhs/${uhsId}`, 'PATCH', daten);
}

export function setzeUhsStatus(einsatzId: number, uhsId: number, status: UhsStatus): Promise<Uhs> {
  return apiSend<Uhs>(`/api/incidents/${einsatzId}/uhs/${uhsId}/status`, 'POST', { status });
}

export function storniereUhs(einsatzId: number, uhsId: number): Promise<void> {
  return apiSend<void>(`/api/incidents/${einsatzId}/uhs/${uhsId}`, 'DELETE');
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
  return apiSend<UhsPlatz[]>(`/api/incidents/${einsatzId}/uhs/${uhsId}/seats/bulk`, 'POST', daten);
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
    `/api/incidents/${einsatzId}/uhs/${uhsId}/seats/${platzId}`,
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
    `/api/incidents/${einsatzId}/uhs/${uhsId}/seats/${platzId}/availability`,
    'POST',
    { verfuegbarkeit, reserviert_fuer_person_id: reserviertFuerPersonId ?? null },
  );
}

export function stornierePlatz(einsatzId: number, uhsId: number, platzId: number): Promise<void> {
  return apiSend<void>(`/api/incidents/${einsatzId}/uhs/${uhsId}/seats/${platzId}`, 'DELETE');
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
    `/api/incidents/${einsatzId}/persons/${personId}/uhs-occupancy`,
    'POST',
    daten,
  );
}

/**
 * Nimmt den Austritt einer Person aus einer UHS zurück (LLH-1924, Spec `personen-detail`,
 * „Austritt aus der UHS zurücknehmen“): zurück auf ihren Platz, wenn er frei ist, sonst in den
 * Wartebereich (`ohne_platz`); die Wartezeit läuft weiter.
 */
export function nimmUhsAustrittZurueck(
  einsatzId: number,
  personId: number,
  belegungId: number,
): Promise<UhsBelegungRuecknahme> {
  return apiSend<UhsBelegungRuecknahme>(
    `/api/incidents/${einsatzId}/persons/${personId}/uhs-occupancy/${belegungId}/undo`,
    'POST',
  );
}

// ---------- Fotos, Pläne und Dateien (LFH-758) ----------

const anhangBasis = (einsatzId: number, uhsId: number) =>
  `/api/incidents/${einsatzId}/uhs/${uhsId}/attachments`;

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
  return `${anhangBasis(einsatzId, uhsId)}/${anhangId}/file`;
}

/** Zugriffsprotokoll der Dateien einer UHS, neueste zuerst — nur für die Einsatzleitung (sonst
 *  403). Die Einsicht selbst wird nicht protokolliert. */
export function ladeUhsAnhangZugriffe(einsatzId: number, uhsId: number): Promise<AnhangZugriff[]> {
  return apiGet<AnhangZugriff[]>(`${anhangBasis(einsatzId, uhsId)}/accesses`);
}
