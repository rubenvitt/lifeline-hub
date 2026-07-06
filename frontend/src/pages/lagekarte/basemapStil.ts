import type { StyleSpecification } from 'maplibre-gl';
import type { KarteServerConfig, OnlineStyle } from '../../api/karte';

export type BasemapModus = 'online' | 'offline' | 'blind';
export type KartenTheme = 'light' | 'dark';
/** Karten-lokale Theme-Wahl (LFH-197): 'auto' folgt dem App-Theme, 'light'/'dark' überschreiben es. */
export type KartenThemeWahl = KartenTheme | 'auto';
/** Löst die karten-lokale Theme-Wahl gegen das aktuelle App-Theme auf. */
export function loeseKartenTheme(wahl: KartenThemeWahl, appTheme: KartenTheme): KartenTheme {
  return wahl === 'auto' ? appTheme : wahl;
}

const FARBEN: Record<KartenTheme, Record<string, string>> = {
  light: {
    hintergrund: '#e8e8e8', erde: '#f5f5f3',
    // Landnutzung nach Shortbread-`kind` gestaffelt (statt einfarbig): Grün/Wald, Acker, Wohnen,
    // Gewerbe, Friedhof, Sand.
    gruen: '#dfeacb', wald: '#d3e2ba', acker: '#f0efe1', wohn: '#efece6',
    gewerbe: '#e9e3dd', friedhof: '#dbe4d2', sand: '#f1e7cf', site: '#ece9e4',
    wasser: '#a8cdf0', wasserLinie: '#7bb0e4',
    gebaeude: '#e2ddd6',
    strasse: '#ffffff', strasseKante: '#dad8d2', bahn: '#c6c2bb', pfad: '#cdcac2',
    grenze: '#c39cc3',
    label: '#3a3a3a', labelWasser: '#3f6ea8', labelHalo: '#ffffff',
  },
  dark: {
    hintergrund: '#0f1115', erde: '#15181d',
    gruen: '#1a2417', wald: '#1f2c19', acker: '#191c15', wohn: '#1a1d22',
    gewerbe: '#1e2128', friedhof: '#172015', sand: '#25241b', site: '#1b1e24',
    wasser: '#15233f', wasserLinie: '#33578c',
    gebaeude: '#23262b',
    strasse: '#33373d', strasseKante: '#41454c', bahn: '#3a3e45', pfad: '#2b2e34',
    grenze: '#5a3f5a',
    label: '#d6d6d6', labelWasser: '#8fb4e0', labelHalo: '#0f1115',
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
  const label = { 'text-color': f.label, 'text-halo-color': f.labelHalo, 'text-halo-width': 1.2 } as const;
  const wasserLabel = { 'text-color': f.labelWasser, 'text-halo-color': f.labelHalo, 'text-halo-width': 1.1 } as const;
  const textFeld = ['coalesce', ['get', 'name_de'], ['get', 'name']] as const;
  const src = 'basemap';
  // source-layer-Namen + `kind`-Vokabulare gegen das reale Shortbread-Schema verifiziert
  // (karten-build, aus den ausgelieferten MBTiles dekodiert, 2026-07-06): u. a. land,
  // water_polygons/water_lines(+_labels), streets, boundaries, bridges, sites existieren.
  // Ein 'landuse'-Layer gibt es in Shortbread NICHT (das war Protomaps) → 'land'.
  // LFH-197: Offline-Style auf die vollständige Shortbread-Geometrie gehoben (Layer-Checkliste gegen
  // die versatiles-Referenz-Styles abgeglichen). Vorher fehlten u. a. `water_lines` (Bäche/Flüsse/
  // Gräben als Linien → unsichtbar) und `ocean` (Meer → zeigte die Land-Hintergrundfarbe). Bewusst
  // NICHT gerendert (niedriger Nutzen / Clutter): pois (Icon-Mapping fehlt, generisches CC0-Sprite),
  // addresses, aerialways, public_transport, street_labels_points, streets_polygons_labels, boundary_labels.
  return {
    version: 8,
    glyphs: '/api/karte/offline/fonts/{fontstack}/{range}.pbf',
    sprite: '/api/karte/offline/sprites/basemap',
    sources: {
      basemap: { type: 'vector', tiles: [tilesUrl], minzoom: 0, maxzoom: 14, attribution: '© OpenStreetMap contributors' },
    },
    // Reihenfolge = Zeichenreihenfolge (unten → oben): Flächen, Wasser, Gebäude, Straßen, Grenzen, Labels.
    layers: [
      { id: 'hintergrund', type: 'background', paint: { 'background-color': f.erde } },
      // FIX: Meer/Ozean (eigener Shortbread-Layer 'ocean', 1 großes Polygon je Küstenkachel) wurde
      // vorher NICHT gerendert → Meere zeigten die Land-Hintergrundfarbe. Als Wasser-Fill ganz unten.
      { id: 'ozean', source: src, 'source-layer': 'ocean', type: 'fill', paint: { 'fill-color': f.wasser } },

      // --- Landnutzung nach kind gestaffelt (statt einfarbig) ---
      {
        id: 'land', source: src, 'source-layer': 'land', type: 'fill',
        paint: {
          'fill-color': ['match', ['get', 'kind'],
            ['forest', 'wood'], f.wald,
            ['grass', 'meadow', 'grassland', 'scrub', 'heath', 'park', 'village_green', 'garden',
              'orchard', 'allotments', 'greenfield', 'plant_nursery', 'greenhouse_horticulture',
              'recreation_ground', 'pitch', 'playground', 'wet_meadow', 'swamp'], f.gruen,
            ['farmland', 'farmyard'], f.acker,
            ['residential'], f.wohn,
            ['industrial', 'commercial', 'retail', 'railway', 'quarry', 'landfill', 'brownfield',
              'garages', 'construction'], f.gewerbe,
            ['cemetery', 'grave_yard'], f.friedhof,
            ['sand', 'beach'], f.sand,
            f.erde],
        },
      },
      // Areale (Parkplätze, Schul-/Klinikgelände …) dezent grau unterlegen.
      { id: 'sites', source: src, 'source-layer': 'sites', type: 'fill', minzoom: 13, paint: { 'fill-color': f.site, 'fill-opacity': 0.55 } },

      // --- Gewässer ---
      { id: 'wasser', source: src, 'source-layer': 'water_polygons', type: 'fill', paint: { 'fill-color': f.wasser } },
      // Dämme (Flächen) + Piers/Molen (begehbar → straßenfarben) über der Wasserfläche.
      { id: 'staudamm_flaechen', source: src, 'source-layer': 'dam_polygons', type: 'fill', minzoom: 12, paint: { 'fill-color': f.gebaeude } },
      { id: 'pier_flaechen', source: src, 'source-layer': 'pier_polygons', type: 'fill', minzoom: 13, paint: { 'fill-color': f.strasse } },
      {
        // FIX (LFH-197): Linien-Gewässer wurden vorher gar nicht gerendert → Bäche/Flüsse/Gräben unsichtbar.
        id: 'wasser_linien', source: src, 'source-layer': 'water_lines', type: 'line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': f.wasserLinie,
          'line-width': ['interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'kind'], ['river', 'canal'], 0.8, 0.3],
            14, ['match', ['get', 'kind'], ['river', 'canal'], 2.2, ['stream'], 1.2, 0.7],
            17, ['match', ['get', 'kind'], ['river', 'canal'], 4, ['stream'], 2, 1.2]],
        },
      },
      // Fährverbindungen (gestrichelt) + Damm-/Pier-Linien.
      { id: 'faehren', source: src, 'source-layer': 'ferries', type: 'line', minzoom: 9, paint: { 'line-color': f.wasserLinie, 'line-dasharray': [2, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 1.2] } },
      { id: 'staudamm_linien', source: src, 'source-layer': 'dam_lines', type: 'line', minzoom: 13, paint: { 'line-color': f.strasseKante, 'line-width': 1 } },
      { id: 'pier_linien', source: src, 'source-layer': 'pier_lines', type: 'line', minzoom: 14, paint: { 'line-color': f.strasseKante, 'line-width': 1.4 } },

      // --- Bebauung / Bauwerke ---
      // Brücken-Deck bodenfarben unterlegen, damit darüber laufende Straßen sauber ablesbar sind.
      { id: 'bruecken', source: src, 'source-layer': 'bridges', type: 'fill', minzoom: 14, paint: { 'fill-color': f.erde, 'fill-opacity': 0.85 } },
      { id: 'gebaeude', source: src, 'source-layer': 'buildings', type: 'fill', minzoom: 13, paint: { 'fill-color': f.gebaeude } },
      // Fußgängerzonen/Plätze als Fläche (Straßen-Linien laufen darüber).
      { id: 'strassen_flaechen', source: src, 'source-layer': 'street_polygons', type: 'fill', minzoom: 14, paint: { 'fill-color': f.strasse } },

      // --- Straßen (Zeichenreihenfolge: Bahn/Wege unten, Hauptstraßen oben) ---
      {
        id: 'bahn', source: src, 'source-layer': 'streets', type: 'line',
        filter: ['==', ['get', 'kind'], 'rail'],
        paint: { 'line-color': f.bahn, 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 1.6] },
      },
      {
        id: 'wege', source: src, 'source-layer': 'streets', type: 'line', minzoom: 13,
        filter: ['match', ['get', 'kind'], ['path', 'track', 'footway', 'steps', 'cycleway', 'bridleway'], true, false],
        paint: { 'line-color': f.pfad, 'line-dasharray': [2, 1.5], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 1.4] },
      },
      {
        id: 'strassen_neben', source: src, 'source-layer': 'streets', type: 'line',
        filter: ['match', ['get', 'kind'], ['residential', 'unclassified', 'living_street', 'service', 'pedestrian'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': f.strasse, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 1.4, 17, 4] },
      },
      {
        id: 'strassen_haupt_kante', source: src, 'source-layer': 'streets', type: 'line',
        filter: ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': f.strasseKante, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 14, 4.5, 17, 9] },
      },
      {
        id: 'strassen_haupt', source: src, 'source-layer': 'streets', type: 'line',
        filter: ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': f.strasse, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 3, 17, 7] },
      },

      // --- Verwaltungsgrenzen (gestrichelt, dezent) ---
      {
        id: 'grenzen', source: src, 'source-layer': 'boundaries', type: 'line',
        filter: ['all', ['has', 'admin_level'], ['<=', ['to-number', ['get', 'admin_level']], 8]],
        paint: { 'line-color': f.grenze, 'line-opacity': 0.6, 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 12, 1.4] },
      },

      // --- Beschriftung ---
      {
        id: 'wasser_linien_namen', source: src, 'source-layer': 'water_lines_labels', type: 'symbol',
        layout: { 'symbol-placement': 'line', 'text-field': textFeld, 'text-font': ['Noto Sans Regular'], 'text-size': 10 },
        paint: wasserLabel,
      },
      {
        id: 'wasser_flaechen_namen', source: src, 'source-layer': 'water_polygons_labels', type: 'symbol',
        layout: { 'text-field': textFeld, 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
        paint: wasserLabel,
      },
      {
        id: 'strassennamen', source: src, 'source-layer': 'street_labels', type: 'symbol',
        layout: { 'symbol-placement': 'line', 'text-field': textFeld, 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
        paint: label,
      },
      {
        id: 'orte', source: src, 'source-layer': 'place_labels', type: 'symbol',
        layout: {
          'text-field': textFeld, 'text-font': ['Noto Sans Regular'],
          'text-size': ['match', ['get', 'kind'], ['city'], 15, ['town'], 13, ['village'], 11, ['suburb', 'neighbourhood', 'hamlet'], 10, 12],
        },
        paint: label,
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

/** Verpackt ein Raster-Tile-Template (`{z}/{x}/{y}`) in einen MapLibre-Raster-Style. Dient online
 *  (proxied Upstream) wie offline (LFH-185: aktive Raster-MBTiles). Die URL wird VERBATIM
 *  durchgereicht (offline root-relativ mit literalen {z}/{x}/{y} → transformRequest absolutiert im
 *  Worker); Attribution läuft NICHT über die Source, sondern config-autoritativ (aktuelleAttribution). */
function rasterStyle(tilesUrl: string, tileSize = 256): StyleSpecification {
  return {
    version: 8,
    sources: {
      raster: { type: 'raster', tiles: [tilesUrl], tileSize },
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
  if (stil.typ === 'raster') return rasterStyle(stil.url);
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
  if (modus === 'offline' && config?.offline_tiles_url) {
    // Raster-Offline-Karte (LFH-185) → Raster-Style; sonst der beschriftete Shortbread-Vektor-Style.
    return config.offline_format === 'raster'
      ? rasterStyle(config.offline_tiles_url)
      : offlineStyle(theme, config.offline_tiles_url);
  }
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
