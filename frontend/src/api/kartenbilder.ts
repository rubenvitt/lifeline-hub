import { apiGet, apiSend, apiUpload } from './client';
import type { components } from './types.generated';

// LFH-265 (Teil A, Frontend): `Hintergrundbild` ist ein Re-Export des generierten Schemas;
// `BildPatch` bleibt als Eingabe-DTO handgepflegt (CLAUDE.md). `Ecke`/`Ecken` sind FE-lokale
// Tupel-Formen für den `ecken`-Multipart-Teil, kein Response-DTO.

export type Ecke = [number, number]; // [lng, lat]
export type Ecken = [Ecke, Ecke, Ecke, Ecke];

/** Rust: `HintergrundbildAnzeige` (Anzeige-DTO ohne BLOB-Bytes). `opazitaet` 0..100. */
export type Hintergrundbild = components['schemas']['HintergrundbildAnzeige'];

export interface BildPatch {
  name?: string;
  ecken_json?: string;
  opazitaet?: number;
  sichtbar?: boolean;
  reihenfolge?: number;
  /** Verschieben/Freigeben (LFH-320): Ziel-Ansicht oder `null` = auf alle Ansichten. */
  ansicht_id?: number | null;
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
  ansichtId?: number | null,
): Promise<Hintergrundbild> {
  const fd = new FormData();
  fd.append('datei', datei);
  fd.append('ecken', JSON.stringify(ecken));
  if (name !== undefined) fd.append('name', name);
  // Ansichts-Zugehörigkeit (LFH-320) als Multipart-Feld — es gibt keinen JSON-Body.
  if (ansichtId != null) fd.append('ansicht_id', String(ansichtId));
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
