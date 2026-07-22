// LFH-265 (Teil A, Frontend): Response-Typen sind Re-Exporte der aus Rust generierten Schemas.
import { apiGet } from './client';
import type { components } from './types.generated';

type S = components['schemas'];

export type FachebeneStatus = S['FachebeneStatus'];

/** GeoJSON FeatureCollection (lose typisiert — Geometrie ist Quell-abhängig).
 *  Rust: `GeoJsonFeatureCollection`, der Schema-Anker für `FachebeneAntwort.features`.
 *
 *  BEWUSSTE UNSCHÄRFE gegenüber der alten Handrolle (LFH-265): `type` ist hier `string`, nicht
 *  das Literal `'FeatureCollection'`/`'Feature'`, und `geometry` ist optional statt required-null.
 *  Das ist die dokumentierte Backend-Entscheidung („bewusst FLACH gehalten", siehe Doc-Kommentar
 *  an `GeoJsonGeometrie`) — Literal-Enums hätten zwei weitere ToSchema-Enums samt Wire-Pins
 *  gekostet. Konsumenten sind davon nicht betroffen: die MapLibre-Übergaben in `fachebenenLayer.ts`
 *  casten ohnehin (`as never`), weil MapLibre eigene GeoJSON-Typen mitbringt. */
export type FeatureCollection = S['GeoJsonFeatureCollection'];

/** Rust: `FachebeneAntwort`. `stand` ist seit LFH-265 ABSENT statt present-null. */
export type FachebeneAntwort = S['FachebeneAntwort'];

/** Pfad-Parameter von `/api/karte/fachebenen/:quelle` — FE-lokal (Eingabeseite, kein Response-DTO). */
export type FachebeneQuelle = 'dwd' | 'pegelonline' | 'nina' | 'kritis';

/** Lädt eine Fachebene. `bbox` (west,sued,ost,nord) ist nur für `kritis` nötig. */
export function ladeFachebene(quelle: FachebeneQuelle, bbox?: string): Promise<FachebeneAntwort> {
  const q = bbox ? `?bbox=${encodeURIComponent(bbox)}` : '';
  return apiGet<FachebeneAntwort>(`/api/karte/fachebenen/${quelle}${q}`);
}
