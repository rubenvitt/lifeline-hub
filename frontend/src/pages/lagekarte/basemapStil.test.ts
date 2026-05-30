import { describe, expect, it } from 'vitest';
import { baueBasemapStyle, blindStyle, defaultModus, offlineStyle } from './basemapStil';
import type { KarteServerConfig } from '../../api/karte';

const beides: KarteServerConfig = {
  online_style_url: 'https://tiles.example/style.json',
  pmtiles_verfuegbar: true,
  pmtiles_url: '/api/karte/tiles.pmtiles',
};
const nurOffline: KarteServerConfig = {
  online_style_url: null, pmtiles_verfuegbar: true, pmtiles_url: '/api/karte/tiles.pmtiles',
};
const leer: KarteServerConfig = { online_style_url: null, pmtiles_verfuegbar: false, pmtiles_url: null };

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

  it('online-Modus liefert die konfigurierte URL als String', () => {
    expect(baueBasemapStyle('online', 'light', beides)).toBe('https://tiles.example/style.json');
  });

  it('blind ist der Fallback, wenn der Modus nicht verfügbar ist', () => {
    const s = baueBasemapStyle('online', 'light', leer);
    expect(typeof s).toBe('object');
    expect((s as { layers: unknown[] }).layers).toHaveLength(1);
  });

  it('defaultModus: online vor offline vor blind', () => {
    expect(defaultModus(beides)).toBe('online');
    expect(defaultModus(nurOffline)).toBe('offline');
    expect(defaultModus(leer)).toBe('blind');
  });
});
