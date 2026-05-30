import type { StyleSpecification } from 'maplibre-gl';
import type { KarteServerConfig } from '../../api/karte';

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
  if (config?.online_style_url) return 'online';
  if (config?.pmtiles_verfuegbar) return 'offline';
  return 'blind';
}

/**
 * Wählt den Style passend zu Modus + Theme + Verfügbarkeit. 'online' liefert die
 * konfigurierte URL (String). Ist der gewünschte Modus nicht verfügbar → Blind-Style.
 */
export function baueBasemapStyle(
  modus: BasemapModus,
  theme: KartenTheme,
  config: KarteServerConfig | undefined,
): StyleSpecification | string {
  if (modus === 'online' && config?.online_style_url) return config.online_style_url;
  if (modus === 'offline' && config?.pmtiles_url) return offlineStyle(theme, config.pmtiles_url);
  return blindStyle(theme);
}
