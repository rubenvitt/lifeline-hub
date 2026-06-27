import type { StyleSpecification } from 'maplibre-gl';
import type { KarteServerConfig, OnlineStyle } from '../../api/karte';

export type BasemapModus = 'online' | 'offline' | 'blind';
export type KartenTheme = 'light' | 'dark';

const FARBEN: Record<KartenTheme, Record<string, string>> = {
  light: {
    erde: '#f5f5f3', wasser: '#a8cdf0', landuse: '#eaf0e2',
    strasse: '#ffffff', gebaeude: '#e4e0da', hintergrund: '#e8e8e8',
  },
  dark: {
    erde: '#15181d', wasser: '#15233f', landuse: '#1b2119',
    strasse: '#33373d', gebaeude: '#23262b', hintergrund: '#0f1115',
  },
};

/** Background-only-Style: rendert immer, auch ganz ohne Tiles ("Blind-Modus"). */
export function blindStyle(theme: KartenTheme): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: 'hintergrund', type: 'background', paint: { 'background-color': FARBEN[theme].hintergrund } },
    ],
  } as StyleSpecification;
}

/**
 * Offline-Vektor-Style über `pmtiles://`. Annahme: Protomaps-Schema-PMTiles
 * (Source-Layer earth/landuse/water/roads/buildings). BEWUSST ohne Text-Layer →
 * keine Glyphs nötig → voll offline. Theme-Farben kommen aus FARBEN.
 */
export function offlineStyle(theme: KartenTheme, pmtilesUrl: string): StyleSpecification {
  const f = FARBEN[theme];
  const absolut = new URL(pmtilesUrl, window.location.origin).href;
  return {
    version: 8,
    sources: {
      protomaps: { type: 'vector', url: `pmtiles://${absolut}` },
    },
    layers: [
      { id: 'hintergrund', type: 'background', paint: { 'background-color': f.erde } },
      { id: 'erde', source: 'protomaps', 'source-layer': 'earth', type: 'fill', paint: { 'fill-color': f.erde } },
      { id: 'landuse', source: 'protomaps', 'source-layer': 'landuse', type: 'fill', paint: { 'fill-color': f.landuse } },
      { id: 'wasser', source: 'protomaps', 'source-layer': 'water', type: 'fill', paint: { 'fill-color': f.wasser } },
      { id: 'strassen', source: 'protomaps', 'source-layer': 'roads', type: 'line', paint: { 'line-color': f.strasse, 'line-width': 1.2 } },
      { id: 'gebaeude', source: 'protomaps', 'source-layer': 'buildings', type: 'fill', paint: { 'fill-color': f.gebaeude } },
    ],
  } as StyleSpecification;
}

/** Default-Modus nach Verfügbarkeit: online → offline → blind. */
export function defaultModus(config: KarteServerConfig | undefined): BasemapModus {
  if (config && config.online_styles.length > 0) return 'online';
  if (config?.pmtiles_verfuegbar) return 'offline';
  return 'blind';
}

/** Verpackt ein Raster-Tile-Template (`{z}/{y}/{x}`) in einen MapLibre-Raster-Style.
 *  URL wird VERBATIM durchgereicht; Attribution läuft NICHT über die Source,
 *  sondern config-autoritativ über `customAttribution` (siehe aktuelleAttribution). */
function rasterStyle(stil: OnlineStyle): StyleSpecification {
  return {
    version: 8,
    sources: {
      raster: { type: 'raster', tiles: [stil.url], tileSize: 256 },
    },
    layers: [{ id: 'raster', type: 'raster', source: 'raster' }],
  } as StyleSpecification;
}

/**
 * `transformRequest` für MapLibre: absolutiert **root-relative** URLs (`/api/karte/proxy/…`,
 * LFH-182) gegen die Origin. MapLibre lädt Tiles in einem Web-Worker ohne Dokument-Base-URL —
 * dort scheitern root-relative Tile-URLs mit „Failed to parse URL". Absolute URLs (Online direkt,
 * `pmtiles://…`) bleiben unangetastet; protokoll-relative `//host` werden bewusst ausgenommen.
 */
export function absolutiereProxyAnfrage(url: string): { url: string } {
  // Bewusst String-Konkatenation statt new URL(): Letzteres würde `{z}`/`{x}`/`{y}` im Pfad
  // percent-kodieren. (MapLibre ruft transformRequest zwar mit substituierten URLs, der Schutz
  // ist defensiv.)
  if (url.startsWith('/') && !url.startsWith('//')) {
    return { url: window.location.origin + url };
  }
  return { url };
}

/** Style für einen Online-View: Vektor → URL-String, Raster → verpackter Raster-Style. */
export function baueOnlineStyle(stil: OnlineStyle): StyleSpecification | string {
  if (stil.typ === 'raster') return rasterStyle(stil);
  // Vektor: Style-JSON-URL. Relative Proxy-URLs (/api/karte/proxy/{id}/style.json, LFH-182) gegen
  // die Origin absolutieren (idempotent für absolute URLs) — analog zu offlineStyle für pmtiles,
  // damit MapLibre die setStyle-URL zuverlässig auflöst.
  return new URL(stil.url, window.location.origin).href;
}

/**
 * Wählt den Style passend zu Modus + Theme + Verfügbarkeit. Im Online-Modus wird der
 * übergebene View verwendet; fehlt er → Blind-Style. Offline → pmtiles-Style.
 */
export function baueBasemapStyle(
  modus: BasemapModus,
  theme: KartenTheme,
  config: KarteServerConfig | undefined,
  onlineStil: OnlineStyle | undefined,
): StyleSpecification | string {
  if (modus === 'online' && onlineStil) return baueOnlineStyle(onlineStil);
  if (modus === 'offline' && config?.pmtiles_url) return offlineStyle(theme, config.pmtiles_url);
  return blindStyle(theme);
}

/**
 * Config-autoritative Pflicht-Attribution des aktiven Views. Online: Attribution des Views;
 * Offline: Lizenz der aktiven Offline-Karte (`pmtiles_attribution`, z. B. ODbL — auch ohne Netz
 * rechtlich sichtbar, LFH-181); blind: keine.
 */
export function aktuelleAttribution(
  modus: BasemapModus,
  onlineStil: OnlineStyle | undefined,
  config: KarteServerConfig | undefined,
): string | null {
  if (modus === 'online' && onlineStil) return onlineStil.attribution;
  if (modus === 'offline') return config?.pmtiles_attribution ?? null;
  return null;
}
