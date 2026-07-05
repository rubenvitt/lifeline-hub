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
  offline_verfuegbar: boolean;
  /** Tile-Endpoint-Template (`{z}/{x}/{y}`) inkl. Cache-Bust `?v=…`, wenn eine Offline-Karte aktiv ist. */
  offline_tiles_url: string | null;
  /** Pflicht-Attribution der aktiven Offline-Karte (offline sichtbar, z. B. ODbL). */
  offline_attribution: string | null;
  /** Grober Kachel-Typ der aktiven Offline-Karte (LFH-185): `'raster'` → Raster-Style, sonst
   * (undefined/null/`'vektor'`) der Shortbread-Vektor-Style. */
  offline_format?: OnlineStyleTyp | null;
  /** True, wenn der zentrale karten-service konfiguriert ist → Admin darf Region-Builds anstoßen
   * (LFH-203). Steuert nur die Sichtbarkeit der Bau-UI, kein Secret. */
  karten_bau_verfuegbar: boolean;
}

export function ladeKarteConfig(): Promise<KarteServerConfig> {
  return apiGet<KarteServerConfig>('/api/karte/config');
}
