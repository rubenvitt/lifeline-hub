import { apiGet } from './client';

/** Was die Karte zur Laufzeit über die Basemap-Verfügbarkeit wissen muss. */
export interface KarteServerConfig {
  online_style_url: string | null;
  pmtiles_verfuegbar: boolean;
  pmtiles_url: string | null;
}

export function ladeKarteConfig(): Promise<KarteServerConfig> {
  return apiGet<KarteServerConfig>('/api/karte/config');
}
