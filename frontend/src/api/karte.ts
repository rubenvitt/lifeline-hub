import { apiGet } from './client';

export type OnlineStyleTyp = 'vektor' | 'raster';

/** Ein benannter Online-Basemap-View (vom Backend geliefert). */
export interface OnlineStyle {
  name: string;
  url: string;
  typ: OnlineStyleTyp;
  attribution: string | null;
}

/** Eine gemeinsam angezeigte Offline-Region (LFH-188). Die Offline-Karte ist die Vereinigung aller
 * bereiten Regionen; je Region eine eigene Vector-Source auf ihren region-adressierten Endpoint. */
export interface OfflineRegion {
  karte_id: number;
  name: string;
  /** Region-adressiertes Tile-Template (`/api/karte/offline/{id}/tiles/{z}/{x}/{y}?v=…`). */
  tiles_url: string;
  attribution: string | null;
  /** `'raster'` (png/jpg/webp) oder sonst Shortbread-Vektor. */
  format: OnlineStyleTyp;
  /** Maximaler Zoom der Vector-Source: Regional-Packs 14, die Welt-Übersicht 6 (LFH-207). */
  maxzoom?: number;
}

/** Was die Karte zur Laufzeit über die Basemap-Verfügbarkeit wissen muss. */
export interface KarteServerConfig {
  online_styles: OnlineStyle[];
  offline_verfuegbar: boolean;
  /** Kompat (LFH-188): Tile-Template der ERSTEN sichtbaren Region. Quelle der Wahrheit ist
   * `offline_regionen`; dieses Feld degradiert alte Clients auf eine Region. */
  offline_tiles_url: string | null;
  /** Pflicht-Attribution der ersten sichtbaren Region (Kompat). */
  offline_attribution: string | null;
  /** Grober Kachel-Typ der ersten sichtbaren Region (Kompat, LFH-185). */
  offline_format?: OnlineStyleTyp | null;
  /** Alle gemeinsam anzuzeigenden Offline-Regionen (LFH-188). Leere Liste = keine Region bereit. */
  offline_regionen?: OfflineRegion[];
  /** True, wenn der zentrale karten-service konfiguriert ist → Admin darf Region-Builds anstoßen
   * (LFH-203). Steuert nur die Sichtbarkeit der Bau-UI, kein Secret. */
  karten_bau_verfuegbar: boolean;
}

export function ladeKarteConfig(): Promise<KarteServerConfig> {
  return apiGet<KarteServerConfig>('/api/karte/config');
}
