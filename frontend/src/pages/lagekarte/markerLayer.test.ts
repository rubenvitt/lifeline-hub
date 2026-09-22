import { describe, it, expect, vi } from 'vitest';
import {
  baueMarkerFc,
  baueEinsatzortFc,
  sorgeFuerMarkerLayer,
  reAnlegenMarker,
  MARKER_CLUSTER_QUELLE,
  MARKER_EINSATZORT_QUELLE,
  MARKER_KLICK_LAYER,
  SPIDER_LEAVES_QUELLE,
  SPIDER_LEGS_QUELLE,
  SPIDER_KLICK_LAYER,
  setzeSpiderDaten,
  BESCHRIFTUNG_AB_ZOOM,
} from './markerLayer';
import { FREIES_ZEICHEN_ERSATZLABEL, type KarteMarker } from './marker';
import { plakettenBildId, zonenPlakette } from './plakette';
import { offlineStyle } from './basemapStil';
import { farbenDunkel, farbenHell } from '../../theme/tokens';

const mk = (p: Partial<KarteMarker>): KarteMarker => ({
  schluessel: 'x',
  typ: 'uhs',
  id: 1,
  lat: 50,
  lon: 8,
  label: 'X',
  farbe: '#000',
  ...p,
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
    const fc = baueMarkerFc([
      mk({
        schluessel: 'fahrzeug-1',
        typ: 'fahrzeug',
        tz: { grundzeichen: 'kraftfahrzeug-landgebunden' },
        statusFarbe: '#00ff00',
      }),
    ]);
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
      mk({
        schluessel: 'schaden-9',
        typ: 'schaden',
        farbe: '#f5222d',
        tz: { grundzeichen: 'gefahr', farbe: '#f5222d' },
      }),
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

/**
 * LFH-622: Namensplaketten an den Markern (Neuentwurf S5). Beschriftet wird, was einen Namen
 * trägt — Lagemeldungen („Meldung #412") und der Ersatztext unbenannter freier Zeichen sind
 * keine Namen und blieben als Dichte ohne Aussage auf der Karte.
 */
describe('Marker-Beschriftung', () => {
  it('trägt den Namen, die Plakettenfarben und einen Rang für die Platzvergabe', () => {
    const fc = baueMarkerFc(
      [
        mk({ schluessel: 'fahrzeug-1', typ: 'fahrzeug', label: 'ELW 1' }),
        mk({ schluessel: 'fuehrung-2', typ: 'fuehrung', label: 'Brandt' }),
      ],
      zonenPlakette(farbenHell),
    );
    const [fzg, fue] = fc.features.map((f) => f.properties);
    expect(fzg.beschriftung).toBe('ELW 1');
    expect(fzg.textFarbe).toBe(farbenHell.text);
    expect(fzg.plakette).toBe(
      plakettenBildId({ grund: farbenHell.paneel, rahmen: farbenHell.linieStark }),
    );
    // Führung vor Fahrzeug: der kleinere Rang gewinnt die Platzvergabe.
    expect(fue.rang!).toBeLessThan(fzg.rang!);
  });

  it('nimmt ohne Angabe die Nachtfarben (Vorgabe des Neuentwurfs)', () => {
    const fc = baueMarkerFc([mk({ label: 'UHS Nord' })]);
    expect(fc.features[0].properties.textFarbe).toBe(farbenDunkel.text);
  });

  it('beschriftet weder Lagemeldungen noch Platzhalter noch leere Namen', () => {
    const fc = baueMarkerFc([
      mk({ schluessel: 'lagemeldung-4', typ: 'lagemeldung', label: 'Meldung #412' }),
      mk({
        schluessel: 'freies_zeichen-1',
        typ: 'freies_zeichen',
        label: FREIES_ZEICHEN_ERSATZLABEL,
      }),
      mk({ schluessel: 'freies_zeichen-2', typ: 'freies_zeichen', label: 'Sperre B6' }),
      mk({ schluessel: 'uhs-3', label: '   ' }),
    ]);
    expect(fc.features.map((f) => f.properties.beschriftung)).toEqual([
      undefined,
      undefined,
      'Sperre B6',
      undefined,
    ]);
    // Ohne Beschriftung auch kein Plakettenbild: der Label-Filter prüft `beschriftung`,
    // ein verwaistes Bild würde trotzdem angefordert.
    expect(fc.features[0].properties.plakette).toBeUndefined();
  });

  it('beschriftet auch den Einsatzort', () => {
    const fc = baueEinsatzortFc([
      mk({ schluessel: 'einsatzort', typ: 'einsatzort', label: 'Deich km 4,2' }),
    ]);
    expect(fc.features[0].properties.beschriftung).toBe('Deich km 4,2');
  });
});

function fakeMap(stil?: unknown) {
  const sources = new Map<string, { spec: unknown; setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, unknown>();
  const moves: string[] = [];
  const map = {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, spec: unknown) => {
      sources.set(id, { spec, setData: vi.fn() });
    }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    addLayer: vi.fn((spec: { id: string }) => {
      layers.set(spec.id, spec);
    }),
    moveLayer: vi.fn((id: string) => {
      moves.push(id);
    }),
    getStyle: vi.fn(() => stil),
  };
  return { map, sources, layers, moves };
}

const leer = { type: 'FeatureCollection' as const, features: [] };

describe('sorgeFuerMarkerLayer', () => {
  it('legt die Cluster-Source mit cluster:true und per-Typ clusterProperties an', () => {
    const { map, sources } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    const spec = sources.get(MARKER_CLUSTER_QUELLE)!.spec as {
      cluster: boolean;
      clusterProperties: Record<string, unknown>;
    };
    expect(spec.cluster).toBe(true);
    expect(spec.clusterProperties.c_fahrzeug).toBeDefined(); // Donut-Aggregation pro Typ
    expect(spec.clusterProperties.c_schaden).toBeDefined();
    expect(sources.has(MARKER_EINSATZORT_QUELLE)).toBe(true);
  });

  it('legt die Einzelmarker-Layer an, aber KEINE circle/symbol-Cluster-Layer (Cluster = DOM-Donut)', () => {
    const { map, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    for (const id of [
      'marker-status-ring',
      'marker-kreis',
      'marker-symbol',
      'marker-einsatzort-symbol',
    ]) {
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

  it('pinnt Marker- UND Spider-Layer nach oben (Beinchen unter den Leaf-Symbolen)', () => {
    const { map, moves } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    // Jeder Layer wird per moveLayer (ohne beforeId) ans Ende = nach oben geschoben, in Mal-Reihenfolge.
    // Marker zuerst, dann der transiente Spider darüber (Beinchen unter den Leaf-Symbolen). Cluster = DOM-Marker.
    // Die Plaketten liegen UNTER den Zeichen: MapLibre vergibt Platz von oben nach unten, die
    // Zeichen (allow-overlap) belegen ihn also zuerst, und keine Plakette deckt ein Zeichen zu.
    expect(moves).toEqual([
      'marker-status-ring',
      'marker-kreis',
      'marker-label',
      'marker-einsatzort-label',
      'marker-symbol',
      'marker-einsatzort-symbol',
      'spider-legs-line',
      'spider-status-ring',
      'spider-kreis',
      'spider-label',
      'spider-symbol',
    ]);
  });

  it('legt alle in MARKER_KLICK_LAYER referenzierten Layer real an (Konstanten-Kopplung)', () => {
    const { map, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    // Schützt vor stillen Klick-Toten: eine Layer-ID-Umbenennung ohne Nachziehen der Konstante
    // bände den Klick-Handler an einen nicht existierenden Layer — hier rot statt unbemerkt.
    for (const id of MARKER_KLICK_LAYER) expect(layers.has(id)).toBe(true);
  });
});

describe('Plaketten-Layer (LFH-622)', () => {
  type Spec = {
    id: string;
    source: string;
    minzoom?: number;
    filter?: unknown;
    layout?: Record<string, unknown>;
    paint?: Record<string, unknown>;
  };
  const specs = (stil?: unknown) => {
    const { map } = fakeMap(stil);
    sorgeFuerMarkerLayer(map as never, leer, leer);
    return new Map(map.addLayer.mock.calls.map((c) => [(c[0] as Spec).id, c[0] as Spec] as const));
  };

  it('legt je Quelle eine Plakette an, die nur beschriftete Einzelmarker zeigt', () => {
    const l = specs();
    expect(l.get('marker-label')!.source).toBe(MARKER_CLUSTER_QUELLE);
    expect(l.get('marker-label')!.filter).toEqual([
      'all',
      ['!', ['has', 'point_count']],
      ['has', 'beschriftung'],
    ]);
    expect(l.get('marker-einsatzort-label')!.source).toBe(MARKER_EINSATZORT_QUELLE);
    expect(l.get('spider-label')!.source).toBe(SPIDER_LEAVES_QUELLE);
    for (const id of ['marker-label', 'marker-einsatzort-label', 'spider-label']) {
      const layout = l.get(id)!.layout!;
      expect(layout['text-field']).toEqual(['get', 'beschriftung']);
      expect(layout['icon-image']).toEqual(['get', 'plakette']);
      expect(layout['icon-text-fit']).toBe('both');
      expect(l.get(id)!.paint!['text-color']).toEqual(['get', 'textFarbe']);
    }
  });

  it('lässt Plaketten kollidieren, die Zeichen aber nie (umgekehrte Regel)', () => {
    const l = specs();
    // Ein Zeichen darf nie verschwinden, eine Plakette schon — sonst überdeckten sich Namen.
    expect(l.get('marker-symbol')!.layout!['icon-allow-overlap']).toBe(true);
    for (const id of ['marker-label', 'marker-einsatzort-label', 'spider-label']) {
      const layout = l.get(id)!.layout!;
      expect(layout['text-allow-overlap']).toBeUndefined();
      expect(layout['icon-allow-overlap']).toBeUndefined();
      // Mehrere Seiten zur Wahl: eine Plakette weicht aus, bevor sie wegfällt.
      expect((layout['text-variable-anchor'] as string[]).length).toBeGreaterThan(1);
    }
    expect(l.get('marker-label')!.layout!['symbol-sort-key']).toEqual(['get', 'rang']);
  });

  it('beschriftet erst ab einer Zoomstufe — der aufgefächerte Spider immer', () => {
    const l = specs();
    expect(l.get('marker-label')!.minzoom).toBe(BESCHRIFTUNG_AB_ZOOM);
    expect(l.get('marker-einsatzort-label')!.minzoom).toBe(BESCHRIFTUNG_AB_ZOOM);
    // Aufgefächert wird zum Unterscheiden — dort ist der Name der Zweck.
    expect(l.get('spider-label')!.minzoom).toBeUndefined();
  });

  it('fordert offline die eingebettete Mono-Schrift an', () => {
    const l = specs(offlineStyle('dark', []));
    expect(l.get('marker-label')!.layout!['text-font']).toEqual(['JetBrains Mono Regular']);
    expect(specs().get('marker-label')!.layout).not.toHaveProperty('text-font');
  });

  it('macht die Plakette zum Klickziel wie das Zeichen', () => {
    expect(MARKER_KLICK_LAYER).toContain('marker-label');
    expect(MARKER_KLICK_LAYER).toContain('marker-einsatzort-label');
    expect(SPIDER_KLICK_LAYER).toContain('spider-label');
  });
});

describe('reAnlegenMarker', () => {
  it('legt an und spielt die (nicht-leeren) Daten unverändert in beide Sources ein', () => {
    const { map, sources } = fakeMap();
    const marker = baueMarkerFc([
      mk({ schluessel: 'uhs-5' }),
      mk({ schluessel: 'schaden-9', typ: 'schaden' }),
    ]);
    const einsatzort = baueEinsatzortFc([mk({ schluessel: 'einsatzort', typ: 'einsatzort' })]);
    reAnlegenMarker(map as never, marker, einsatzort);
    expect(sources.get(MARKER_CLUSTER_QUELLE)!.setData).toHaveBeenCalledWith(marker);
    expect(sources.get(MARKER_EINSATZORT_QUELLE)!.setData).toHaveBeenCalledWith(einsatzort);
    expect(marker.features).toHaveLength(2); // Daten unverändert durchgereicht
  });
});

describe('Spider-Layer', () => {
  it('legt Spider-Sources (ungeclustert) + Beinchen-Linie + Leaf-Layer an', () => {
    const { map, sources, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    expect(sources.has(SPIDER_LEAVES_QUELLE)).toBe(true);
    expect(sources.has(SPIDER_LEGS_QUELLE)).toBe(true);
    expect(
      (sources.get(SPIDER_LEAVES_QUELLE)!.spec as { cluster?: boolean }).cluster,
    ).toBeUndefined();
    for (const id of ['spider-legs-line', 'spider-status-ring', 'spider-kreis', 'spider-symbol']) {
      expect(layers.has(id)).toBe(true);
    }
  });

  it('alle SPIDER_KLICK_LAYER existieren real (Konstanten-Kopplung)', () => {
    const { map, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    for (const id of SPIDER_KLICK_LAYER) expect(layers.has(id)).toBe(true);
  });

  it('setzeSpiderDaten spielt Leaves + Beinchen in die Spider-Sources', () => {
    const { map, sources } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    const leaves = { type: 'FeatureCollection' as const, features: [] };
    const legs = { type: 'FeatureCollection' as const, features: [] };
    setzeSpiderDaten(map as never, leaves, legs);
    expect(sources.get(SPIDER_LEAVES_QUELLE)!.setData).toHaveBeenCalledWith(leaves);
    expect(sources.get(SPIDER_LEGS_QUELLE)!.setData).toHaveBeenCalledWith(legs);
  });
});
