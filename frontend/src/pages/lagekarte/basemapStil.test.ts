import { describe, expect, it } from 'vitest';
import {
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
  pmtiles_verfuegbar: true,
  pmtiles_url: '/api/karte/tiles.pmtiles',
};
const nurOffline: KarteServerConfig = {
  online_styles: [], pmtiles_verfuegbar: true, pmtiles_url: '/api/karte/tiles.pmtiles',
};
const leer: KarteServerConfig = { online_styles: [], pmtiles_verfuegbar: false, pmtiles_url: null };

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

  it('aktuelleAttribution: online liefert View-Attribution, sonst null', () => {
    expect(aktuelleAttribution('online', vektorView)).toBe('© A');
    expect(aktuelleAttribution('online', undefined)).toBeNull();
    expect(aktuelleAttribution('offline', vektorView)).toBeNull();
    expect(aktuelleAttribution('blind', rasterView)).toBeNull();
  });
});
