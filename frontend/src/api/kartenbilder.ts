import { apiGet, apiSend, apiUpload } from './client';
import type { components } from './types.generated';

// `Hintergrundbild` ist ein Re-Export des generierten Schemas; `BildPatch` bleibt als Eingabe-DTO
// handgepflegt. `Ecke`/`Ecken` sind FE-lokale Tupel für den `ecken`-Multipart-Teil.

export type Ecke = [number, number]; // [lng, lat]
export type Ecken = [Ecke, Ecke, Ecke, Ecke];

/** Rust: `HintergrundbildAnzeige` (Anzeige-DTO ohne BLOB-Bytes). `opazitaet` 0..100. */
export type Hintergrundbild = components['schemas']['HintergrundbildAnzeige'];

interface BildPatch {
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

/** Bricht ab, sobald eines der Signale abbricht. `AbortSignal.any` erst ab Safari 17.4. */
function eines(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const ctrl = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) ctrl.abort(s.reason);
    else s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/** Lädt die Bild-Bytes (same-origin, mit Cookies) und liefert eine Object-URL.
 *  Aufrufer MUSS die URL später mit URL.revokeObjectURL freigeben. `signal` bricht zusätzlich
 *  zur 15-s-Grenze ab (Karte verlassen, Einsatzwechsel; LFH-943). */
export async function ladeBildBlobUrl(
  einsatzId: number,
  id: number,
  signal?: AbortSignal,
): Promise<string> {
  const grenze = AbortSignal.timeout(15_000);
  const res = await fetch(bildDownloadPfad(einsatzId, id), {
    credentials: 'same-origin',
    signal: signal ? eines(signal, grenze) : grenze,
  });
  if (!res.ok) throw new Error(`Bild ${id} konnte nicht geladen werden (${res.status})`);
  return URL.createObjectURL(await res.blob());
}
