import { apiGet } from './client';

export type OnlineStyleTyp = 'vektor' | 'raster' | 'protomaps';

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
  offline_verfuegbar: boolean;
  /** Tile-Endpoint-Template (`{z}/{x}/{y}`) inkl. Cache-Bust `?v=…`, wenn eine Offline-Karte aktiv ist. */
  offline_tiles_url: string | null;
  /** Pflicht-Attribution der aktiven Offline-Karte (offline sichtbar, z. B. ODbL). */
  offline_attribution: string | null;
}

export function ladeKarteConfig(): Promise<KarteServerConfig> {
  return apiGet<KarteServerConfig>('/api/karte/config');
}
