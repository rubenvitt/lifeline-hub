import type { Schaden, SchadenAnhang, SchadenStatus, SchadenTyp, Ausmass } from './types';
import { apiGet, apiSend, apiUpload } from './client';
import { UPLOAD_TIMEOUT_MS } from './upload';

/** Felder beim Anlegen (Typ + Ort + Ausmaß Pflicht; Rest optional). Geschädigt FK XOR Freitext. */
export interface SchadenEingabe {
  typ: SchadenTyp;
  ausmass: Ausmass;
  ort: string;
  beschreibung?: string | null;
  lat?: number | null;
  lon?: number | null;
  geschaedigt_person_id?: number | null;
  geschaedigt_personal_id?: number | null;
  geschaedigt_organisation_id?: number | null;
  geschaedigt_kontakt?: string | null;
}

/** Patch-Felder (nur Stammfelder + Audit-Felder; NICHT Status). Geschädigt-/Übergabe-Felder
 *  akzeptieren `null` = leeren (Toggle). */
export interface SchadenPatch {
  typ?: SchadenTyp;
  ausmass?: Ausmass;
  ort?: string;
  beschreibung?: string;
  geschaedigt_person_id?: number | null;
  geschaedigt_personal_id?: number | null;
  geschaedigt_organisation_id?: number | null;
  geschaedigt_kontakt?: string | null;
  uebergeben_an?: string | null;
  abschluss_grund?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface SchaedenFilter {
  status?: SchadenStatus;
  typ?: SchadenTyp;
  ausmass?: Ausmass;
  geschaedigtPersonId?: number;
  inklStorniert?: boolean;
}

export function listeSchaeden(einsatzId: number, filter: SchaedenFilter = {}): Promise<Schaden[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.typ) params.set('typ', filter.typ);
  if (filter.ausmass) params.set('ausmass', filter.ausmass);
  if (filter.geschaedigtPersonId != null)
    params.set('geschaedigt_person_id', String(filter.geschaedigtPersonId));
  if (filter.inklStorniert) params.set('inkl_storniert', 'true');
  const q = params.toString();
  return apiGet<Schaden[]>(`/api/einsaetze/${einsatzId}/schaeden${q ? `?${q}` : ''}`);
}

export function ladeSchaden(einsatzId: number, schadenId: number): Promise<Schaden> {
  return apiGet<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`);
}

export function legeSchadenAn(einsatzId: number, daten: SchadenEingabe): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden`, 'POST', daten);
}

/**
 * Optimistisches Lock (LFH-300/F10): `basisGeaendertAt` trägt den beim Laden gelesenen
 * `geaendert_at`-Stand. Ist er veraltet → 409 statt stillem Overwrite. Ohne Baseline
 * (Lagekarten-Drag lat/lon, Geschädigt-Zuordnung aus der Personen-Detailseite,
 * Konfliktdialog-Overwrite) wird bewusst blind geschrieben.
 */
export function aktualisiereSchaden(
  einsatzId: number,
  schadenId: number,
  daten: SchadenPatch,
  basisGeaendertAt?: string,
): Promise<Schaden> {
  const body = basisGeaendertAt ? { ...daten, basis_geaendert_at: basisGeaendertAt } : daten;
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`, 'PATCH', body);
}

export function uebergebeSchaden(
  einsatzId: number,
  schadenId: number,
  uebergeben_an: string,
): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}/uebergeben`, 'POST', {
    uebergeben_an,
  });
}

export function schliesseSchadenAb(
  einsatzId: number,
  schadenId: number,
  abschluss_grund: string,
  notiz?: string,
): Promise<Schaden> {
  return apiSend<Schaden>(
    `/api/einsaetze/${einsatzId}/schaeden/${schadenId}/abschliessen`,
    'POST',
    {
      abschluss_grund,
      notiz: notiz ?? null,
    },
  );
}

export function storniereSchaden(einsatzId: number, schadenId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`, 'DELETE');
}

/** Registriernummer-Anzeige wie im Backend (S-007). */
export function schadenRegistrierAnzeige(nr: number): string {
  return `S-${String(nr).padStart(3, '0')}`;
}

// ---------- Fotos und Dateien (LFH-21) ----------

const anhangBasis = (einsatzId: number, schadenId: number) =>
  `/api/einsaetze/${einsatzId}/schaeden/${schadenId}/anhaenge`;

/** Lebende Anhänge eines Schadens, neueste zuerst. */
export function listeSchadenAnhaenge(
  einsatzId: number,
  schadenId: number,
): Promise<SchadenAnhang[]> {
  return apiGet<SchadenAnhang[]>(anhangBasis(einsatzId, schadenId));
}

/**
 * Legt EINE Datei am Schaden ab (Feld `datei`, design.md D5). Mehrere Fotos entstehen über
 * den Serienmodus des Dialogs, jedes mit eigenem ETB-Nachweis. Timeout wie die übrigen
 * Uploads (25 MiB samt Virenscan über Mobilfunk).
 */
export function legeSchadenAnhangAb(
  einsatzId: number,
  schadenId: number,
  datei: File,
): Promise<SchadenAnhang> {
  const fd = new FormData();
  fd.append('datei', datei);
  return apiUpload<SchadenAnhang>(anhangBasis(einsatzId, schadenId), fd, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
}

/** Entfernt einen Anhang (Soft-Delete mit ETB-Nachweis); `anhangId` ist die Linker-id. */
export function entferneSchadenAnhang(
  einsatzId: number,
  schadenId: number,
  anhangId: number,
): Promise<void> {
  return apiSend<void>(`${anhangBasis(einsatzId, schadenId)}/${anhangId}`, 'DELETE');
}

/**
 * Download über die modul-gegatete Schadensroute — nie über `/anhaenge/{aid}` des Einsatzes
 * (dort 404, die Datei ist modulgebunden). Ein API-Pfad, keine Navigation, deshalb hier und
 * nicht in `routing/deeplinks.ts` (wie `dokumentDownloadPfad`).
 */
export function schadenAnhangDownloadPfad(
  einsatzId: number,
  schadenId: number,
  anhangId: number,
): string {
  return `${anhangBasis(einsatzId, schadenId)}/${anhangId}/datei`;
}
