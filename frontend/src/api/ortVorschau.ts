// LFH-265 (Teil A, Frontend): Response-Typen sind Re-Exporte der aus Rust generierten Schemas.
import { apiGet } from './client';
import type { components } from './types.generated';

type S = components['schemas'];

/** Peilung zum nächsten bekannten verorteten Punkt des Einsatzes. Rust: `PeilungAntwort`. */
export type Peilung = S['PeilungAntwort'];

/** Antwort von GET /api/einsaetze/:id/ort-vorschau. Rust: `OrtVorschauAntwort`.
 *  Beide Felder degradieren — seit LFH-265 ABSENT statt present-null (gepinnt per `contains_key`
 *  in `tests/ort_vorschau.rs`). Konsumenten prüfen deshalb truthy, nicht `=== null`. */
export type OrtVorschau = S['OrtVorschauAntwort'];

/** Lädt die Ort-Vorschau (Peilung + ggf. Ortsname) für eine Koordinate. */
export function ladeOrtVorschau(
  einsatzId: number,
  lat: number,
  lon: number,
  exclude?: string,
): Promise<OrtVorschau> {
  const p = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (exclude) p.set('exclude', exclude);
  return apiGet<OrtVorschau>(`/api/einsaetze/${einsatzId}/ort-vorschau?${p.toString()}`);
}
