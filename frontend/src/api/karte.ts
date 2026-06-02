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
  pmtiles_url: string | null;
}

export function ladeKarteConfig(): Promise<KarteServerConfig> {
  return apiGet<KarteServerConfig>('/api/karte/config');
}
