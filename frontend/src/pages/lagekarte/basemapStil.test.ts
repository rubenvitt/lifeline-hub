import { describe, expect, it } from 'vitest';
import {
  absolutiereProxyAnfrage,
  aktuelleAttribution,
  baueBasemapStyle,
  baueOnlineStyle,
  blindStyle,
  defaultModus,
  offlineStyle,
  protomapsLabeledStyle,
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
  pmtiles_verfuegbar: true,
  pmtiles_url: '/api/karte/tiles.pmtiles?v=abc',
  pmtiles_attribution: null,
};
const nurOffline: KarteServerConfig = {
  online_styles: [], pmtiles_verfuegbar: true, pmtiles_url: '/api/karte/tiles.pmtiles?v=abc',
  pmtiles_attribution: '© OpenStreetMap contributors (ODbL)',
};
const leer: KarteServerConfig = {
  online_styles: [], pmtiles_verfuegbar: false, pmtiles_url: null, pmtiles_attribution: null,
};

describe('basemapStil', () => {
  it('blindStyle rendert nur einen Hintergrund-Layer', () => {
    const s = blindStyle('dark');
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].type).toBe('background');
  });

  it('offlineStyle referenziert die pmtiles-Source', () => {
    const s = offlineStyle('light', '/api/karte/tiles.pmtiles');
    expect(JSON.stringify(s.sources)).toContain('pmtiles://');
    expect(s.layers.some((l) => l.type === 'symbol')).toBe(false);
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
    expect(absolutiereProxyAnfrage('pmtiles://https://x/a')).toEqual({ url: 'pmtiles://https://x/a' });
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

  it('defaultModus: online (Liste nicht leer) vor offline vor blind', () => {
    expect(defaultModus(beides)).toBe('online');
    expect(defaultModus(nurOffline)).toBe('offline');
    expect(defaultModus(leer)).toBe('blind');
  });

  it('aktuelleAttribution: online View-Attribution, offline pmtiles_attribution, sonst null', () => {
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

  it('protomapsLabeledStyle: Label-Layer + glyphs + proxied Quelle', () => {
    const s = protomapsLabeledStyle('light', '/api/karte/proxy/3/tilejson') as {
      glyphs: string;
      sources: Record<string, { url: string }>;
      layers: Array<{ id: string; type: string; layout?: Record<string, unknown> }>;
    };
    expect(s.glyphs).toContain('protomaps.github.io');
    expect(s.sources.protomaps.url).toBe(`${window.location.origin}/api/karte/proxy/3/tilejson`);
    const ids = s.layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['orte', 'strassennamen', 'erde', 'wasser']));
    // Jeder Symbol-Layer hat text-font (sonst rendert MapLibre keine Glyphs).
    for (const l of s.layers.filter((l) => l.type === 'symbol')) {
      expect(l.layout?.['text-font']).toBeTruthy();
    }
  });

  it('baueBasemapStyle: protomaps-Quelle → Protomaps-Style (Objekt, nicht URL-String)', () => {
    const s = baueBasemapStyle('online', 'light', undefined, {
      name: 'Protomaps', url: '/api/karte/proxy/3/tilejson', typ: 'protomaps', attribution: '©',
    });
    expect(typeof s).toBe('object');
    const style = s as { sources: Record<string, unknown> };
    expect(style.sources.protomaps).toBeTruthy();
  });
});
