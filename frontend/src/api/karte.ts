// LFH-265 (Teil A, Frontend): Response-Typen sind Re-Exporte der aus Rust generierten Schemas
// (types.generated.ts), keine Handrolle mehr. Namens-Mapping FE ↔ Rust wie in `types.ts`.
import { apiGet } from './client';
import type { components } from './types.generated';

type S = components['schemas'];

export type OnlineStyleTyp = S['OnlineStyleTyp'];

/** Ein benannter Online-Basemap-View (vom Backend geliefert). */
export type OnlineStyle = S['OnlineStyle'];

/** Eine gemeinsam angezeigte Offline-Region (LFH-188). Die Offline-Karte ist die Vereinigung aller
 * bereiten Regionen; je Region eine eigene Vector-Source auf ihren region-adressierten Endpoint.
 * `maxzoom` ist seit LFH-265 PFLICHT — das Backend liefert es immer (Regional-Packs 14,
 * Welt-Übersicht 6); die Handrolle führte es fälschlich optional. */
export type OfflineRegion = S['OfflineRegionConfig'];

/** Was die Karte zur Laufzeit über die Basemap-Verfügbarkeit wissen muss.
 * Rust: `KarteConfigAntwort`. `offline_regionen` ist PFLICHT (leere Liste = keine Region bereit);
 * die Kompat-Felder `offline_tiles_url`/`offline_attribution`/`offline_format` sind seit LFH-265
 * ABSENT statt present-null, wenn keine Region bereit ist. */
export type KarteServerConfig = S['KarteConfigAntwort'];

export function ladeKarteConfig(): Promise<KarteServerConfig> {
  return apiGet<KarteServerConfig>('/api/karte/config');
}
