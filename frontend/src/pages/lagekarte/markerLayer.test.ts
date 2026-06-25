import { describe, it, expect, vi } from 'vitest';
import {
  baueMarkerFc, baueEinsatzortFc, sorgeFuerMarkerLayer, reAnlegenMarker,
  MARKER_CLUSTER_QUELLE, MARKER_EINSATZORT_QUELLE, MARKER_KLICK_LAYER,
} from './markerLayer';
import type { KarteMarker } from './marker';

const mk = (p: Partial<KarteMarker>): KarteMarker => ({
  schluessel: 'x', typ: 'uhs', id: 1, lat: 50, lon: 8, label: 'X', farbe: '#000', ...p,
});

describe('baueMarkerFc', () => {
  it('nimmt den Einsatzort aus (wird separat, ungeclustert gerendert)', () => {
    const fc = baueMarkerFc([
      mk({ schluessel: 'einsatzort', typ: 'einsatzort' }),
      mk({ schluessel: 'uhs-5' }),
    ]);
    expect(fc.features.map((f) => f.properties.schluessel)).toEqual(['uhs-5']);
  });

  it('setzt icon für TZ-Marker und statusFarbe für Fahrzeuge', () => {
    const fc = baueMarkerFc([mk({
      schluessel: 'fahrzeug-1', typ: 'fahrzeug',
      tz: { grundzeichen: 'kraftfahrzeug-landgebunden' }, statusFarbe: '#00ff00',
    })]);
    expect(fc.features[0].properties.icon?.startsWith('tz|')).toBe(true);
    expect(fc.features[0].properties.statusFarbe).toBe('#00ff00');
  });

  it('lässt icon bei Lagemeldung (kein tz) weg → wird als Kreis gerendert', () => {
    const fc = baueMarkerFc([mk({ schluessel: 'lagemeldung-4', typ: 'lagemeldung' })]);
    expect(fc.features[0].properties.icon).toBeUndefined();
    expect(fc.features[0].properties.statusFarbe).toBeUndefined();
  });

  it('schreibt Point-Geometrie als [lon, lat]', () => {
    const fc = baueMarkerFc([mk({ lon: 8.6, lat: 50.1 })]);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [8.6, 50.1] });
  });

  it('behält Reihenfolge, propagiert Schaden-Farbe und schreibt typ (für die Cluster-Aggregation)', () => {
    const fc = baueMarkerFc([
      mk({ schluessel: 'uhs-5' }),
      mk({ schluessel: 'schaden-9', typ: 'schaden', farbe: '#f5222d', tz: { grundzeichen: 'gefahr', farbe: '#f5222d' } }),
    ]);
    expect(fc.features.map((f) => f.properties.schluessel)).toEqual(['uhs-5', 'schaden-9']);
    expect(fc.features.map((f) => f.properties.typ)).toEqual(['uhs', 'schaden']);
    expect(fc.features[1].properties.farbe).toBe('#f5222d');
  });
});

describe('baueEinsatzortFc', () => {
  it('liefert genau den Einsatzort-Marker', () => {
    const fc = baueEinsatzortFc([
      mk({ schluessel: 'einsatzort', typ: 'einsatzort', tz: { grundzeichen: 'anlass' } }),
      mk({ schluessel: 'uhs-5' }),
    ]);
    expect(fc.features.map((f) => f.properties.schluessel)).toEqual(['einsatzort']);
    expect(fc.features[0].properties.icon?.startsWith('tz|')).toBe(true);
  });

  it('ist leer, wenn kein Einsatzort verortet ist', () => {
    expect(baueEinsatzortFc([mk({ schluessel: 'uhs-5' })]).features).toHaveLength(0);
  });
});

function fakeMap() {
  const sources = new Map<string, { spec: unknown; setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, unknown>();
  const moves: string[] = [];
  const map = {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, spec: unknown) => { sources.set(id, { spec, setData: vi.fn() }); }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    addLayer: vi.fn((spec: { id: string }) => { layers.set(spec.id, spec); }),
    moveLayer: vi.fn((id: string) => { moves.push(id); }),
  };
  return { map, sources, layers, moves };
}

const leer = { type: 'FeatureCollection' as const, features: [] };

describe('sorgeFuerMarkerLayer', () => {
  it('legt die Cluster-Source mit cluster:true und per-Typ clusterProperties an', () => {
    const { map, sources } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    const spec = sources.get(MARKER_CLUSTER_QUELLE)!.spec as { cluster: boolean; clusterProperties: Record<string, unknown> };
    expect(spec.cluster).toBe(true);
    expect(spec.clusterProperties.c_fahrzeug).toBeDefined(); // Donut-Aggregation pro Typ
    expect(spec.clusterProperties.c_schaden).toBeDefined();
    expect(sources.has(MARKER_EINSATZORT_QUELLE)).toBe(true);
  });

  it('legt die Einzelmarker-Layer an, aber KEINE circle/symbol-Cluster-Layer (Cluster = DOM-Donut)', () => {
    const { map, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    for (const id of ['marker-status-ring', 'marker-kreis', 'marker-symbol', 'marker-einsatzort-symbol']) {
      expect(layers.has(id)).toBe(true);
    }
    expect(layers.has('marker-cluster-bubble')).toBe(false);
    expect(layers.has('marker-cluster-count')).toBe(false);
  });

  it('ist idempotent (zweiter Aufruf legt nichts doppelt an)', () => {
    const { map } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    const addSourceCalls = map.addSource.mock.calls.length;
    sorgeFuerMarkerLayer(map as never, leer, leer);
    expect(map.addSource.mock.calls.length).toBe(addSourceCalls);
  });

  it('die Einzelmarker-Layer schließen Cluster aus (point_count-Negation, nicht gate-blind)', () => {
    const { map, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    const symbol = layers.get('marker-symbol') as { filter: unknown };
    const kreis = layers.get('marker-kreis') as { filter: unknown };
    // Beide Einzelmarker-Layer MÜSSEN die Cluster-Aggregate ausschließen (Negation '!' + point_count).
    for (const f of [symbol.filter, kreis.filter]) {
      expect(JSON.stringify(f)).toContain('"!"');
      expect(JSON.stringify(f)).toContain('point_count');
    }
    // … und sich am icon unterscheiden (symbol: hat icon; kreis: kein icon).
    expect(symbol.filter).not.toEqual(kreis.filter);
  });

  it('pinnt die Marker-Layer nach oben (über Abschnitten/Zonen/Bildern)', () => {
    const { map, moves } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    // Jeder Marker-Layer wird per moveLayer (ohne beforeId) ans Ende = nach oben geschoben,
    // in Mal-Reihenfolge (Status-Ring unten … Einsatzort-Symbol oben). Cluster = DOM-Marker (kein Layer).
    expect(moves).toEqual(['marker-status-ring', 'marker-kreis', 'marker-symbol', 'marker-einsatzort-symbol']);
  });

  it('legt alle in MARKER_KLICK_LAYER referenzierten Layer real an (Konstanten-Kopplung)', () => {
    const { map, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    // Schützt vor stillen Klick-Toten: eine Layer-ID-Umbenennung ohne Nachziehen der Konstante
    // bände den Klick-Handler an einen nicht existierenden Layer — hier rot statt unbemerkt.
    for (const id of MARKER_KLICK_LAYER) expect(layers.has(id)).toBe(true);
  });
});

describe('reAnlegenMarker', () => {
  it('legt an und spielt die (nicht-leeren) Daten unverändert in beide Sources ein', () => {
    const { map, sources } = fakeMap();
    const marker = baueMarkerFc([mk({ schluessel: 'uhs-5' }), mk({ schluessel: 'schaden-9', typ: 'schaden' })]);
    const einsatzort = baueEinsatzortFc([mk({ schluessel: 'einsatzort', typ: 'einsatzort' })]);
    reAnlegenMarker(map as never, marker, einsatzort);
    expect(sources.get(MARKER_CLUSTER_QUELLE)!.setData).toHaveBeenCalledWith(marker);
    expect(sources.get(MARKER_EINSATZORT_QUELLE)!.setData).toHaveBeenCalledWith(einsatzort);
    expect(marker.features).toHaveLength(2); // Daten unverändert durchgereicht
  });
});
