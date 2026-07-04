import { describe, expect, it } from 'vitest';
import {
  absolutiereProxyAnfrage,
  aktuelleAttribution,
  baueBasemapStyle,
  baueOnlineStyle,
  blindStyle,
  defaultModus,
  offlineStyle,
} from './basemapStil';
import type { KarteServerConfig, OnlineStyle } from '../../api/karte';

const vektorView: OnlineStyle = {
  name: 'A', url: 'https://tiles.example/style.json', typ: 'vektor', attribution: '© A',
};
const rasterView: OnlineStyle = {
  name: 'Top', url: 'https://x/{z}/{y}/{x}.png', typ: 'raster', attribution: '© BKG',
};

const beides: KarteServerConfig = {
  online_styles: [vektorView],
  offline_verfuegbar: true,
  offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
  offline_attribution: null,
};
const nurOffline: KarteServerConfig = {
  online_styles: [], offline_verfuegbar: true, offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
  offline_attribution: '© OpenStreetMap contributors (ODbL)',
};
const leer: KarteServerConfig = {
  online_styles: [], offline_verfuegbar: false, offline_tiles_url: null, offline_attribution: null,
};

describe('basemapStil', () => {
  it('blindStyle rendert nur einen Hintergrund-Layer', () => {
    const s = blindStyle('dark');
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].type).toBe('background');
  });

  it('baueOnlineStyle: Vektor liefert die URL als String', () => {
    expect(baueOnlineStyle(vektorView)).toBe('https://tiles.example/style.json');
  });

  it('absolutiereProxyAnfrage: root-relative Proxy-URL → absolut, andere unangetastet (LFH-182)', () => {
    const o = window.location.origin;
    // MapLibre ruft transformRequest mit substituierter Tile-URL (keine {z}-Platzhalter mehr).
    expect(absolutiereProxyAnfrage('/api/karte/proxy/1/tile/5/6/34/22')).toEqual({
      url: `${o}/api/karte/proxy/1/tile/5/6/34/22`,
    });
    expect(absolutiereProxyAnfrage('https://x/y')).toEqual({ url: 'https://x/y' });
    expect(absolutiereProxyAnfrage('//host/x')).toEqual({ url: '//host/x' });
  });

  it('baueOnlineStyle: relative Vektor-Proxy-URL wird gegen die Origin absolutiert (LFH-182)', () => {
    const proxyView: OnlineStyle = {
      name: 'P', url: '/api/karte/proxy/1/style.json', typ: 'vektor', attribution: null,
    };
    expect(baueOnlineStyle(proxyView)).toBe(
      new URL('/api/karte/proxy/1/style.json', window.location.origin).href,
    );
  });

  it('baueOnlineStyle: relatives Raster-Proxy-Template bleibt relatives tiles[0] (LFH-182)', () => {
    const proxyRaster: OnlineStyle = {
      name: 'P', url: '/api/karte/proxy/1/raster/{z}/{x}/{y}', typ: 'raster', attribution: null,
    };
    const s = baueOnlineStyle(proxyRaster) as {
      sources: Record<string, { tiles: string[] }>;
    };
    expect(s.sources.raster.tiles).toEqual(['/api/karte/proxy/1/raster/{z}/{x}/{y}']);
  });

  it('baueOnlineStyle: Raster verpackt das Template in einen Raster-Style', () => {
    const s = baueOnlineStyle(rasterView);
    expect(typeof s).toBe('object');
    const style = s as { sources: Record<string, { type: string; tiles: string[]; tileSize: number }> };
    const src = style.sources.raster;
    expect(src.type).toBe('raster');
    expect(src.tiles).toEqual(['https://x/{z}/{y}/{x}.png']); // verbatim, NICHT normalisiert
    expect(src.tileSize).toBe(256);
    // Attribution NICHT in der Source (läuft über customAttribution) → keine Doppelanzeige.
    expect(JSON.stringify(src)).not.toContain('© BKG');
  });

  it('online-Modus mit View liefert dessen Style', () => {
    expect(baueBasemapStyle('online', 'light', beides, vektorView)).toBe('https://tiles.example/style.json');
  });

  it('online ohne View → Blind-Fallback', () => {
    const s = baueBasemapStyle('online', 'light', leer, undefined);
    expect(typeof s).toBe('object');
    expect((s as { layers: unknown[] }).layers).toHaveLength(1);
  });

  it('offline-Modus: Vektor-Format → Shortbread-Vektor-Style, Raster-Format → Raster-Style (LFH-185)', () => {
    // Ohne offline_format (Default) → beschrifteter Shortbread-Style mit Vektor-Source.
    const vektor = baueBasemapStyle('offline', 'light', nurOffline, undefined) as {
      sources: Record<string, { type: string }>;
    };
    expect(vektor.sources.basemap.type).toBe('vector');
    // offline_format='raster' → Raster-Style mit dem Offline-Tiles-Template VERBATIM.
    const rasterConfig: KarteServerConfig = { ...nurOffline, offline_format: 'raster' };
    const raster = baueBasemapStyle('offline', 'light', rasterConfig, undefined) as {
      sources: Record<string, { type: string; tiles: string[] }>;
    };
    expect(raster.sources.raster.type).toBe('raster');
    expect(raster.sources.raster.tiles).toEqual(['/api/karte/offline/tiles/{z}/{x}/{y}?v=abc']);
  });

  it('defaultModus: online (Liste nicht leer) vor offline vor blind', () => {
    expect(defaultModus(beides)).toBe('online');
    expect(defaultModus(nurOffline)).toBe('offline');
    expect(defaultModus(leer)).toBe('blind');
  });

  it('aktuelleAttribution: online View-Attribution, offline offline_attribution, sonst null', () => {
    expect(aktuelleAttribution('online', vektorView, beides)).toBe('© A');
    expect(aktuelleAttribution('online', undefined, beides)).toBeNull();
    // Offline: Lizenz der aktiven Offline-Karte aus der Config (LFH-181, offline sichtbar).
    expect(aktuelleAttribution('offline', undefined, nurOffline)).toBe(
      '© OpenStreetMap contributors (ODbL)',
    );
    // Offline ohne hinterlegte Lizenz → null.
    expect(aktuelleAttribution('offline', vektorView, leer)).toBeNull();
    expect(aktuelleAttribution('blind', rasterView, beides)).toBeNull();
  });

});

describe('offlineStyle (Shortbread)', () => {
  const style = offlineStyle('light', '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc') as {
    glyphs: string;
    sprite: string;
    sources: Record<string, { type: string; tiles: string[] }>;
    layers: Array<{ id: string; type: string; 'source-layer'?: string; layout?: Record<string, unknown> }>;
  };
  it('nutzt lokale Glyphs/Sprite (offline)', () => {
    expect(style.glyphs).toBe('/api/karte/offline/fonts/{fontstack}/{range}.pbf');
    expect(style.sprite).toBe('/api/karte/offline/sprites/basemap');
  });
  it('bindet eine Vektor-Source mit dem Tile-Template', () => {
    const src = style.sources.basemap;
    expect(src.type).toBe('vector');
    expect(src.tiles[0]).toContain('/api/karte/offline/tiles/{z}/{x}/{y}');
  });
  it('rendert Shortbread-Layer inkl. Ortslabels mit name_de', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain('wasser');
    expect(ids).toContain('strassen');
    const orte = style.layers.find((l) => l.id === 'orte');
    expect(orte?.['source-layer']).toBe('place_labels');
    expect(orte?.layout?.['text-field']).toEqual(['coalesce', ['get', 'name_de'], ['get', 'name']]);
  });
});
