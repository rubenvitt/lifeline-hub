import { describe, expect, it } from 'vitest';
import {
  absolutiereProxyAnfrage,
  aktuelleAttribution,
  baueBasemapStyle,
  baueOnlineStyle,
  blindStyle,
  defaultModus,
  loeseKartenTheme,
  offlineStyle,
} from './basemapStil';
import type { KarteServerConfig, OfflineRegion, OnlineStyle } from '../../api/karte';

const vektorView: OnlineStyle = {
  name: 'A', url: 'https://tiles.example/style.json', typ: 'vektor', attribution: '© A',
};
const rasterView: OnlineStyle = {
  name: 'Top', url: 'https://x/{z}/{y}/{x}.png', typ: 'raster', attribution: '© BKG',
};

const ODBL = '© OpenStreetMap contributors (ODbL)';
/** Eine Offline-Region im Config-Vertrag (LFH-188), region-adressiert.
 *  `maxzoom` ist seit LFH-265 Pflicht im generierten Schema; 14 = Regional-Pack-Voll-Detail. */
function region(karte_id: number, format: OnlineStyle['typ'] = 'vektor', maxzoom = 14): OfflineRegion {
  return {
    karte_id, name: `R${karte_id}`,
    tiles_url: `/api/karte/offline/${karte_id}/tiles/{z}/{x}/{y}?v=abc`,
    attribution: ODBL, format, maxzoom,
  };
}

const beides: KarteServerConfig = {
  online_styles: [vektorView],
  offline_verfuegbar: true,
  offline_tiles_url: '/api/karte/offline/1/tiles/{z}/{x}/{y}?v=abc',
  offline_attribution: ODBL,
  offline_regionen: [region(1)],
  karten_bau_verfuegbar: false,
};
const nurOffline: KarteServerConfig = {
  online_styles: [], offline_verfuegbar: true,
  offline_tiles_url: '/api/karte/offline/5/tiles/{z}/{x}/{y}?v=abc',
  offline_attribution: ODBL, offline_regionen: [region(5)], karten_bau_verfuegbar: false,
};
const leer: KarteServerConfig = {
  online_styles: [], offline_verfuegbar: false, offline_tiles_url: null, offline_attribution: null,
  offline_regionen: [], karten_bau_verfuegbar: false,
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

  it('offline-Modus: Vektor-Regionen → Multi-Source-Shortbread-Style, Raster → Raster-Style (LFH-185/188)', () => {
    // Vektor-Region → beschrifteter Shortbread-Style mit region-adressierter Source basemap-{id}.
    const vektor = baueBasemapStyle('offline', 'light', nurOffline, undefined) as {
      sources: Record<string, { type: string }>;
    };
    expect(vektor.sources['basemap-5'].type).toBe('vector');
    // Raster-Region (selten/legacy) → über den Kompat-Pfad ein Raster-Style mit dem Template VERBATIM.
    const rasterConfig: KarteServerConfig = {
      ...nurOffline, offline_format: 'raster', offline_regionen: [region(5, 'raster')],
    };
    const raster = baueBasemapStyle('offline', 'light', rasterConfig, undefined) as {
      sources: Record<string, { type: string; tiles: string[] }>;
    };
    expect(raster.sources.raster.type).toBe('raster');
    expect(raster.sources.raster.tiles).toEqual(['/api/karte/offline/5/tiles/{z}/{x}/{y}?v=abc']);
  });

  it('offline-Modus: mehrere Regionen → je eine Vector-Source basemap-{id} (LFH-188)', () => {
    const multi: KarteServerConfig = { ...nurOffline, offline_regionen: [region(5), region(8)] };
    const s = baueBasemapStyle('offline', 'light', multi, undefined) as {
      sources: Record<string, { type: string; tiles: string[] }>;
      layers: Array<{ id: string }>;
    };
    expect(s.sources['basemap-5'].type).toBe('vector');
    expect(s.sources['basemap-8'].type).toBe('vector');
    expect(s.sources['basemap-5'].tiles[0]).toContain('/api/karte/offline/5/tiles/');
    expect(s.sources['basemap-8'].tiles[0]).toContain('/api/karte/offline/8/tiles/');
    // Beide Regionen tragen die suffixierten Orts-Labels; Layer-IDs bleiben eindeutig.
    const ids = s.layers.map((l) => l.id);
    expect(ids).toContain('orte-5');
    expect(ids).toContain('orte-8');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offline-Modus: Config mit leeren offline_regionen → Fallback über offline_tiles_url', () => {
    // LFH-265: `offline_regionen` ist im generierten Schema PFLICHT; „keine Region bereit" ist
    // die LEERE Liste, nicht das fehlende Feld (so dokumentiert das Backend das Feld auch).
    // Der geprüfte Code-Pfad ist unverändert derselbe — `vektorRegionen.length === 0` → Kompat.
    const alt: KarteServerConfig = {
      online_styles: [], offline_verfuegbar: true, offline_regionen: [],
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
      offline_attribution: ODBL, karten_bau_verfuegbar: false,
    };
    const s = baueBasemapStyle('offline', 'light', alt, undefined) as {
      sources: Record<string, { type: string; tiles: string[] }>;
    };
    // Kompat: eine Region mit karte_id 0 aus offline_tiles_url.
    expect(s.sources['basemap-0'].type).toBe('vector');
    expect(s.sources['basemap-0'].tiles[0]).toBe('/api/karte/offline/tiles/{z}/{x}/{y}?v=abc');
  });

  it('loeseKartenTheme: auto folgt dem App-Theme, explizite Wahl überschreibt', () => {
    expect(loeseKartenTheme('auto', 'light')).toBe('light');
    expect(loeseKartenTheme('auto', 'dark')).toBe('dark');
    expect(loeseKartenTheme('dark', 'light')).toBe('dark'); // überschreibt hell → dunkel
    expect(loeseKartenTheme('light', 'dark')).toBe('light'); // überschreibt dunkel → hell
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

  it('aktuelleAttribution: mehrere Regionen dedupliziert (nicht N-fach, LFH-188)', () => {
    // Zwei Regionen mit identischer ODbL-Attribution → genau eine Anzeige.
    const zweiGleich: KarteServerConfig = { ...nurOffline, offline_regionen: [region(1), region(2)] };
    expect(aktuelleAttribution('offline', undefined, zweiGleich)).toBe(ODBL);
    // Unterschiedliche Attributionen → beide, mit Trenner.
    const zweiVerschieden: KarteServerConfig = {
      ...nurOffline,
      offline_regionen: [region(1), { ...region(2), attribution: '© Andere Quelle' }],
    };
    expect(aktuelleAttribution('offline', undefined, zweiVerschieden)).toBe(`${ODBL} · © Andere Quelle`);
  });

});

describe('offlineStyle (Shortbread, Multi-Region)', () => {
  // Eine Region mit karte_id 7 → Source basemap-7, Layer-IDs mit -7 suffixiert.
  const style = offlineStyle('light', [region(7)]) as {
    glyphs: string;
    sprite: string;
    sources: Record<string, { type: string; tiles: string[] }>;
    layers: Array<{ id: string; type: string; 'source-layer'?: string; layout?: Record<string, unknown> }>;
  };
  it('nutzt lokale Glyphs/Sprite (offline)', () => {
    expect(style.glyphs).toBe('/api/karte/offline/fonts/{fontstack}/{range}.pbf');
    expect(style.sprite).toBe('/api/karte/offline/sprites/basemap');
  });
  it('bindet je Region eine region-adressierte Vektor-Source basemap-{id}', () => {
    const src = style.sources['basemap-7'];
    expect(src.type).toBe('vector');
    expect(src.tiles[0]).toContain('/api/karte/offline/7/tiles/{z}/{x}/{y}');
  });
  it('genau ein gemeinsamer Hintergrund-Layer (nicht je Region)', () => {
    const bg = style.layers.filter((l) => l.type === 'background');
    expect(bg).toHaveLength(1);
    expect(bg[0].id).toBe('hintergrund');
  });
  it('rendert Shortbread-Layer (region-suffixiert) inkl. Ortslabels mit name_de', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain('wasser-7');
    expect(ids).toContain('strassen_haupt-7');
    const orte = style.layers.find((l) => l.id === 'orte-7');
    expect(orte?.['source-layer']).toBe('place_labels');
    expect(orte?.layout?.['text-field']).toEqual(['coalesce', ['get', 'name_de'], ['get', 'name']]);
  });
  it('rendert Linien-Gewässer (water_lines) als eigenen Line-Layer (LFH-197-Regression)', () => {
    // Vorher fehlte water_lines komplett → Bäche/Flüsse/Gräben (Linien) blieben unsichtbar,
    // nur breite water_polygons-Flächen kamen an.
    const wasserLinien = style.layers.find((l) => l['source-layer'] === 'water_lines');
    expect(wasserLinien?.type).toBe('line');
    // Flächen-Wasser bleibt ein Fill.
    const wasserFlaeche = style.layers.find((l) => l.id === 'wasser-7');
    expect(wasserFlaeche?.['source-layer']).toBe('water_polygons');
    expect(wasserFlaeche?.type).toBe('fill');
  });
  it('rendert das Meer (ocean) als Wasser-Fill (LFH-197-Regression)', () => {
    // Vorher fehlte 'ocean' → Meere zeigten die Land-Hintergrundfarbe.
    const ozean = style.layers.find((l) => l['source-layer'] === 'ocean');
    expect(ozean?.type).toBe('fill');
  });
  it('deckt die Shortbread-Geometrie-Layer vollständig ab (keine stille Lücke mehr)', () => {
    // Checkliste gegen die versatiles-Referenz: alle sichtbaren Geometrie-Layer müssen gestylt sein.
    const sourceLayers = new Set(
      style.layers.map((l) => l['source-layer']).filter((s): s is string => !!s),
    );
    for (const erwartet of [
      'ocean', 'land', 'water_polygons', 'water_lines', 'buildings', 'streets',
      'bridges', 'sites', 'boundaries', 'dam_polygons', 'dam_lines',
      'pier_polygons', 'pier_lines', 'ferries', 'street_polygons',
    ]) {
      expect(sourceLayers.has(erwartet)).toBe(true);
    }
  });
  it('alle Layer verweisen auf ihre region-adressierte Source (basemap-7)', () => {
    const geo = style.layers.filter((l) => l.type !== 'background') as Array<{ source?: string }>;
    expect(geo.length).toBeGreaterThan(0);
    expect(geo.every((l) => l.source === 'basemap-7')).toBe(true);
  });
  it('per-Region maxzoom: Welt-Übersicht 6, Regional-Pack 14 (LFH-207)', () => {
    // Seit LFH-265 liefert das Backend `maxzoom` für JEDE Region (Schema-Pflichtfeld) — der frühere
    // FE-seitige `?? 14`-Fallback ist entfallen. Geprüft wird jetzt die Durchreichung pro Region:
    // jede Source bekommt ihren eigenen Wert, nicht einen global gleichen.
    const s = offlineStyle('light', [
      { karte_id: 0, name: 'Welt-Übersicht', tiles_url: '/api/karte/offline/welt/tiles/{z}/{x}/{y}?v=w', attribution: 'ODbL', format: 'vektor', maxzoom: 6 },
      region(7),
    ]) as { sources: Record<string, { maxzoom: number }> };
    expect(s.sources['basemap-0'].maxzoom).toBe(6);
    expect(s.sources['basemap-7'].maxzoom).toBe(14);
  });
});
