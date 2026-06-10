import { apiGet } from './client';

export type FachebeneStatus = 'ok' | 'leer' | 'offline';

/** GeoJSON FeatureCollection (lose typisiert — Geometrie ist Quell-abhängig). */
export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown } | null;
    properties: Record<string, unknown>;
  }>;
}

export interface FachebeneAntwort {
  quelle: string;
  status: FachebeneStatus;
  attribution: string;
  stand: string | null;
  features: FeatureCollection;
}

export type FachebeneQuelle = 'dwd' | 'pegelonline' | 'nina' | 'kritis';

/** Lädt eine Fachebene. `bbox` (west,sued,ost,nord) ist nur für `kritis` nötig. */
export function ladeFachebene(quelle: FachebeneQuelle, bbox?: string): Promise<FachebeneAntwort> {
  const q = bbox ? `?bbox=${encodeURIComponent(bbox)}` : '';
  return apiGet<FachebeneAntwort>(`/api/karte/fachebenen/${quelle}${q}`);
}
