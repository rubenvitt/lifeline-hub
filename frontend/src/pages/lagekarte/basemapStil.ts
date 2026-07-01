import type { StyleSpecification } from 'maplibre-gl';
import type { KarteServerConfig, OnlineStyle } from '../../api/karte';

export type BasemapModus = 'online' | 'offline' | 'blind';
export type KartenTheme = 'light' | 'dark';

const FARBEN: Record<KartenTheme, Record<string, string>> = {
  light: {
    erde: '#f5f5f3', wasser: '#a8cdf0', landuse: '#eaf0e2',
    strasse: '#ffffff', gebaeude: '#e4e0da', hintergrund: '#e8e8e8',
    label: '#3a3a3a', labelHalo: '#ffffff',
  },
  dark: {
    erde: '#15181d', wasser: '#15233f', landuse: '#1b2119',
    strasse: '#33373d', gebaeude: '#23262b', hintergrund: '#0f1115',
    label: '#d6d6d6', labelHalo: '#0f1115',
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
 * Offline-Vektor-Style über die selbst-servierten Shortbread-MBTiles-Kacheln (LFH-195).
 * Glyphs/Sprite kommen lokal aus dem Binary → Beschriftung offline verfügbar. Theme-Farben aus FARBEN.
 */
export function offlineStyle(theme: KartenTheme, tilesUrl: string): StyleSpecification {
  const f = FARBEN[theme];
  // tilesUrl bleibt ROOT-RELATIV mit literalen {z}/{x}/{y}: NICHT via new URL() absolutieren —
  // das würde die Platzhalter percent-kodieren (%7Bz%7D), MapLibre substituiert sie dann nie →
  // 0 Tiles. (Siehe absolutiereProxyAnfrage-Kommentar + Memory [[maplibre-rootrelative-url-worker]].)
  // Der global verdrahtete transformRequest (absolutiereProxyAnfrage, Kartenflaeche.tsx:202)
  // absolutiert die substituierte Kachel-/Glyph-/Sprite-URL im Worker gegen die Origin.
  return {
    version: 8,
    glyphs: '/api/karte/offline/fonts/{fontstack}/{range}.pbf',
    sprite: '/api/karte/offline/sprites/basemap',
    sources: {
      basemap: { type: 'vector', tiles: [tilesUrl], minzoom: 0, maxzoom: 14, attribution: '© OpenStreetMap contributors' },
    },
    layers: [
      { id: 'hintergrund', type: 'background', paint: { 'background-color': f.erde } },
      { id: 'landuse', source: 'basemap', 'source-layer': 'landuse', type: 'fill', paint: { 'fill-color': f.landuse } },
      { id: 'wasser', source: 'basemap', 'source-layer': 'water_polygons', type: 'fill', paint: { 'fill-color': f.wasser } },
      { id: 'gebaeude', source: 'basemap', 'source-layer': 'buildings', type: 'fill', paint: { 'fill-color': f.gebaeude } },
      { id: 'strassen', source: 'basemap', 'source-layer': 'streets', type: 'line', paint: { 'line-color': f.strasse, 'line-width': 1.2 } },
      {
        id: 'strassennamen', source: 'basemap', 'source-layer': 'street_labels', type: 'symbol',
        layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name_de'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
        paint: { 'text-color': f.label, 'text-halo-color': f.labelHalo, 'text-halo-width': 1.2 },
      },
      {
        id: 'orte', source: 'basemap', 'source-layer': 'place_labels', type: 'symbol',
        layout: { 'text-field': ['coalesce', ['get', 'name_de'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': f.label, 'text-halo-color': f.labelHalo, 'text-halo-width': 1.2 },
      },
    ],
  } as StyleSpecification;
}

/** Default-Modus nach Verfügbarkeit: online → offline → blind. */
export function defaultModus(config: KarteServerConfig | undefined): BasemapModus {
  if (config && config.online_styles.length > 0) return 'online';
  if (config?.offline_verfuegbar) return 'offline';
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
 * dort scheitern root-relative Tile-URLs mit „Failed to parse URL". Bereits absolute URLs
 * (Online direkt) bleiben unangetastet; protokoll-relative `//host` werden bewusst ausgenommen.
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
  // die Origin absolutieren (idempotent für bereits absolute URLs), damit MapLibre die
  // setStyle-URL zuverlässig auflöst.
  return new URL(stil.url, window.location.origin).href;
}

/**
 * Wählt den Style passend zu Modus + Theme + Verfügbarkeit. Im Online-Modus wird der
 * übergebene View verwendet; fehlt er → Blind-Style. Offline → Shortbread-Style.
 */
export function baueBasemapStyle(
  modus: BasemapModus,
  theme: KartenTheme,
  config: KarteServerConfig | undefined,
  onlineStil: OnlineStyle | undefined,
): StyleSpecification | string {
  if (modus === 'online' && onlineStil) return baueOnlineStyle(onlineStil);
  if (modus === 'offline' && config?.offline_tiles_url) return offlineStyle(theme, config.offline_tiles_url);
  return blindStyle(theme);
}

/**
 * Config-autoritative Pflicht-Attribution des aktiven Views. Online: Attribution des Views;
 * Offline: Lizenz der aktiven Offline-Karte (`offline_attribution`, z. B. ODbL — auch ohne Netz
 * rechtlich sichtbar, LFH-181); blind: keine.
 */
export function aktuelleAttribution(
  modus: BasemapModus,
  onlineStil: OnlineStyle | undefined,
  config: KarteServerConfig | undefined,
): string | null {
  if (modus === 'online' && onlineStil) return onlineStil.attribution;
  if (modus === 'offline') return config?.offline_attribution ?? null;
  return null;
}
