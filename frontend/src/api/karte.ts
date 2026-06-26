import { apiGet } from './client';

export type OnlineStyleTyp = 'vektor' | 'raster';

/** Ein benannter Online-Basemap-View (vom Backend geliefert). */
export interface OnlineStyle {
  name: string;
  url: string;
  typ: OnlineStyleTyp;
  attribution: string | null;
}

/** Was die Karte zur Laufzeit über die Basemap-Verfügbarkeit wissen muss. */
export interface KarteServerConfig {
  online_styles: OnlineStyle[];
  pmtiles_verfuegbar: boolean;
  /** Tile-Endpoint-URL inkl. Cache-Bust-Token (`?v=…`), wenn eine aktive Offline-Karte bereit ist. */
  pmtiles_url: string | null;
  /** Pflicht-Attribution der aktiven Offline-Karte (offline sichtbar, z. B. ODbL); `null` ohne aktive Karte. */
  pmtiles_attribution: string | null;
}

export function ladeKarteConfig(): Promise<KarteServerConfig> {
  return apiGet<KarteServerConfig>('/api/karte/config');
}
