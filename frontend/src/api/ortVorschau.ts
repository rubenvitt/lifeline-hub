// Response-Typen sind Re-Exporte der aus Rust generierten Schemas.
import { apiGet, mitParametern } from './client';
import type { components } from './types.generated';

type S = components['schemas'];

/** Antwort von GET /api/einsaetze/:id/ort-vorschau. Rust: `OrtVorschauAntwort`. Beide Felder
 *  degradieren und FEHLEN dann (statt `null`); Konsumenten prüfen truthy, nicht `=== null`. */
export type OrtVorschau = S['OrtVorschauAntwort'];

/** Lädt die Ort-Vorschau (Peilung + ggf. Ortsname) für eine Koordinate. */
export function ladeOrtVorschau(
  einsatzId: number,
  lat: number,
  lon: number,
  exclude?: string,
): Promise<OrtVorschau> {
  return apiGet<OrtVorschau>(
    mitParametern(`/api/einsaetze/${einsatzId}/ort-vorschau`, { lat, lon, exclude }),
  );
}
