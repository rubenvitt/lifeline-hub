import { apiGet, apiSend, apiUpload } from './client';

export type Ecke = [number, number]; // [lng, lat]
export type Ecken = [Ecke, Ecke, Ecke, Ecke];

export interface Hintergrundbild {
  id: number;
  einsatz_id: number;
  name: string;
  mime: string;
  groesse: number;
  ecken_json: string;
  opazitaet: number;   // 0..100
  sichtbar: boolean;
  reihenfolge: number;
  hochgeladen_von: number;
  erstellt_at: string;
  geaendert_at: string;
}

export interface BildPatch {
  name?: string;
  ecken_json?: string;
  opazitaet?: number;
  sichtbar?: boolean;
  reihenfolge?: number;
}

const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/karte/hintergrundbilder`;

export function listeHintergrundbilder(einsatzId: number): Promise<Hintergrundbild[]> {
  return apiGet<Hintergrundbild[]>(basis(einsatzId));
}

export function ladeHintergrundbildHoch(
  einsatzId: number,
  datei: File,
  ecken: Ecken,
  name?: string,
): Promise<Hintergrundbild> {
  const fd = new FormData();
  fd.append('datei', datei);
  fd.append('ecken', JSON.stringify(ecken));
  if (name !== undefined) fd.append('name', name);
  return apiUpload<Hintergrundbild>(basis(einsatzId), fd);
}

export function aktualisiereHintergrundbild(
  einsatzId: number,
  id: number,
  patch: BildPatch,
): Promise<Hintergrundbild> {
  return apiSend<Hintergrundbild>(`${basis(einsatzId)}/${id}`, 'PATCH', patch);
}

export function loescheHintergrundbild(einsatzId: number, id: number): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/${id}`, 'DELETE');
}

export function bildDownloadPfad(einsatzId: number, id: number): string {
  return `${basis(einsatzId)}/${id}/download`;
}

/** Lädt die Bild-Bytes (same-origin, mit Cookies) und liefert eine Object-URL.
 *  Aufrufer MUSS die URL später mit URL.revokeObjectURL freigeben. */
export async function ladeBildBlobUrl(einsatzId: number, id: number): Promise<string> {
  const res = await fetch(bildDownloadPfad(einsatzId, id), { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Bild ${id} konnte nicht geladen werden (${res.status})`);
  return URL.createObjectURL(await res.blob());
}
