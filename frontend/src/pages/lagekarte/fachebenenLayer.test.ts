import { describe, it, expect, vi } from 'vitest';
import {
  sorgeFuerFachebeneLayer,
  entferneFachebeneLayer,
  fachebeneSourceId,
  fachebeneClickLayerIds,
  kategorieLabel,
  entscheideFachebeneKlick,
} from './fachebenenLayer';
import { farbenHell } from '../../theme/tokens';
import { FACHEBENEN } from './fachebenen';

function fakeMap() {
  const sources = new Set<string>();
  const layers = new Set<string>();
  const specs = new Map<string, LayerSpec>();
  const sourceOptionen = new Map<string, Record<string, unknown>>();
  // Reihenfolge der angelegten Layer — MapLibre zeichnet später angelegte oben.
  const reihenfolge: string[] = [];
  return {
    getSource: vi.fn((id: string) => (sources.has(id) ? {} : undefined)),
    addSource: vi.fn((id: string, optionen: Record<string, unknown>) => {
      sources.add(id);
      sourceOptionen.set(id, optionen);
    }),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    addLayer: vi.fn((l: LayerSpec) => {
      layers.add(l.id);
      specs.set(l.id, l);
      reihenfolge.push(l.id);
    }),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    _sources: sources,
    _layers: layers,
    _specs: specs,
    _sourceOptionen: sourceOptionen,
    _reihenfolge: reihenfolge,
  };
}

interface LayerSpec {
  id: string;
  type?: string;
  filter?: unknown;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

/**
 * Wertet den Teil der MapLibre-Filtersprache aus, den die Fachebenen benutzen (`any`, `all`,
 * `!`, `has`). Ohne Auswertung prüfte ein Test nur die Schreibweise des Filters — ein
 * vertauschtes `any`/`all` sähe im Vergleich mit einem ebenso vertauschten Literal grün aus.
 */
function passt(filter: unknown, props: Record<string, unknown>): boolean {
  if (filter === undefined) return true;
  const [op, ...args] = filter as [string, ...unknown[]];
  switch (op) {
    case 'any':
      return args.some((a) => passt(a, props));
    case 'all':
      return args.every((a) => passt(a, props));
    case '!':
      return !passt(args[0], props);
    case 'has':
      return (args[0] as string) in props;
    default:
      throw new Error(`Filter-Operator ${op} im Test nicht ausgewertet`);
  }
}

// Die drei Feature-Arten, die in der KRITIS-Source vorkommen (Spec „Viele Objekte werden
// serverseitig verdichtet" + Client-Bündel von MapLibre).
const clientBuendel = { cluster: true, cluster_id: 7, point_count: 3, anzahl: 1203 };
const sammelpunkt = { sammelpunkt: true, anzahl: 1200 };
const einzelobjekt = { titel: 'Klinikum', kategorie: 'krankenhaus' };

const leer = { type: 'FeatureCollection', features: [] } as const;

describe('fachebenenLayer', () => {
  it('legt Source + Polygon-Layer für DWD an (idempotent)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    expect(m._sources.has(fachebeneSourceId('dwd'))).toBe(true);
    expect(m._layers.has('fachebene-dwd-fill')).toBe(true);
    expect(m._layers.has('fachebene-dwd-line')).toBe(true);
    // nur einmal angelegt
    expect(m.addSource).toHaveBeenCalledTimes(1);
  });

  it('legt Circle-Layer für Punkt-Ebene (pegelonline) an', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.pegelonline, leer as never);
    expect(m._layers.has('fachebene-pegelonline-circle')).toBe(true);
  });

  it('lässt das Feature über Farbe und Radius bestimmen, mit der Ebenenfarbe als Rückfall', () => {
    // Die Hochwasserebene (LFH-77) staffelt beides je Pegelklasse und backt die Werte in
    // die Properties (`hochwasserStil.ts`). Ein fester `circle-color`/`circle-radius`
    // würde diese Werte stillschweigend verwerfen — die Ebene sähe einfarbig aus, ohne
    // dass irgendwo etwas rot wird. Ebenen ohne die Properties fallen auf ihre Farbe
    // zurück, deshalb steht der Rückfall hier mit in der Zusicherung.
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.pegelonline, leer as never);
    const paint = m._specs.get('fachebene-pegelonline-circle')?.paint;
    expect(paint?.['circle-color']).toEqual([
      'coalesce',
      ['get', 'farbe'],
      FACHEBENEN.pegelonline.farbe,
    ]);
    expect(paint?.['circle-radius']).toEqual(['coalesce', ['get', 'radius'], 5]);
  });

  it('zeichnet größere Punkte über kleinere — eine erhöhte Sonde verschwindet nicht (LFH-78)', () => {
    // Ohne Sortierschlüssel folgt die Zeichenreihenfolge der Quellreihenfolge: bei ~1 600
    // dicht stehenden ODL-Sonden legte sich ein später gezeichneter kleiner Nachbar samt
    // weißem Rand über einen großen `stark_erhoeht`-Punkt. Der Radius IST die Stufe (je
    // höher, desto größer), also sortiert er auch — MapLibre zeichnet höhere Schlüssel oben.
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.odl, leer as never);
    const layout = m._specs.get('fachebene-odl-circle')?.layout;
    expect(layout?.['circle-sort-key']).toEqual(['coalesce', ['get', 'radius'], 0]);
  });

  it('legt KRITIS als gebündelte Source an, die Sammelpunkte mit Gewicht zählt (LFH-83)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never);
    // Zweiter Lauf (z. B. Re-Anlage nach setStyle): Source-Optionen greifen NUR beim
    // Anlegen — eine einmal ungebündelt angelegte Source bliebe es für immer.
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never);
    expect(m.addSource).toHaveBeenCalledTimes(1);
    const opt = m._sourceOptionen.get(fachebeneSourceId('kritis'));
    expect(opt).toMatchObject({ type: 'geojson', cluster: true, clusterMaxZoom: 14 });
    expect(opt?.clusterRadius).toBeGreaterThanOrEqual(40);
    expect(opt?.clusterRadius).toBeLessThanOrEqual(60);
    // Ein Server-Sammelpunkt zählt mit seiner `anzahl`, ein Einzelobjekt mit 1 — sonst
    // zeigte ein Bündel aus drei Sammelpunkten „3" statt der tausenden Objekte darin.
    expect(opt?.clusterProperties).toEqual({
      anzahl: ['+', ['coalesce', ['get', 'anzahl'], 1]],
    });
  });

  it('bündelt nur die Ebenen mit `buendeln` — die übrigen Punktebenen bleiben ungebündelt', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.odl, leer as never);
    expect(m._sourceOptionen.get(fachebeneSourceId('odl'))?.cluster).toBeUndefined();
    expect(m._layers.has('fachebene-odl-buendel')).toBe(false);
  });

  it('teilt die KRITIS-Features überschneidungsfrei auf Bündel und Einzelpunkt auf (LFH-83)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never);
    const kreis = m._specs.get('fachebene-kritis-buendel')!;
    const zahl = m._specs.get('fachebene-kritis-buendel-zahl')!;
    const einzel = m._specs.get('fachebene-kritis-circle')!;
    expect(kreis.type).toBe('circle');
    expect(zahl.type).toBe('symbol');
    expect(einzel.type).toBe('circle');
    // Ein allein stehender Server-Sammelpunkt ist KEIN MapLibre-Bündel (kein point_count),
    // muss aber genauso als Bündel gezeichnet werden.
    for (const props of [clientBuendel, sammelpunkt]) {
      expect(passt(kreis.filter, props)).toBe(true);
      expect(passt(zahl.filter, props)).toBe(true);
      expect(passt(einzel.filter, props)).toBe(false);
    }
    expect(passt(kreis.filter, einzelobjekt)).toBe(false);
    expect(passt(zahl.filter, einzelobjekt)).toBe(false);
    expect(passt(einzel.filter, einzelobjekt)).toBe(true);
  });

  it('beschriftet das Bündel mit seiner Gesamtzahl in fester Schrift (LFH-83)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never);
    const zahl = m._specs.get('fachebene-kritis-buendel-zahl')!;
    const feld = JSON.stringify(zahl.layout?.['text-field']);
    // `anzahl` trägt beides: die Clustersumme (clusterProperties) und die Zahl eines
    // Server-Sammelpunkts. `point_count` wäre beim Sammelpunkt gar nicht da und zählte beim
    // Client-Bündel Sammelpunkte als 1.
    expect(feld).toContain('"anzahl"');
    // Die einzige Schrift, die der Offline-Style ausliefert (assets/karten/fonts/).
    expect(zahl.layout?.['text-font']).toEqual(['Noto Sans Regular']);
    // Überdeckung: die Zahl gehört auf ihren Kreis, nicht verdrängt von einer Nachbarzahl.
    expect(zahl.layout?.['text-allow-overlap']).toBe(true);
  });

  it('zeichnet die Bündel in der Ebenenfarbe mit Kontur und Text/Halo aus den Tokens (LFH-83)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never);
    const kreis = m._specs.get('fachebene-kritis-buendel')!.paint!;
    const zahl = m._specs.get('fachebene-kritis-buendel-zahl')!.paint!;
    expect(kreis['circle-color']).toBe(FACHEBENEN.kritis.farbe);
    expect(kreis['circle-stroke-color']).toBe(farbenHell.flaeche);
    expect(zahl['text-color']).toBe(farbenHell.flaeche);
    expect(zahl['text-halo-color']).toBe(farbenHell.text);
  });

  it('legt die Zahl über ihren Kreis (Zeichenreihenfolge)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never);
    expect(m._reihenfolge.indexOf('fachebene-kritis-buendel-zahl')).toBeGreaterThan(
      m._reihenfolge.indexOf('fachebene-kritis-buendel'),
    );
  });

  it('räumt beim Entfernen alle drei KRITIS-Layer und die Source (idempotent)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never);
    entferneFachebeneLayer(m as never, 'kritis');
    entferneFachebeneLayer(m as never, 'kritis');
    expect(m._layers.size).toBe(0);
    expect(m._sources.size).toBe(0);
    // Wieder anlegen geht — keine Leiche, an der `addLayer` mit „already exists" scheiterte.
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never);
    expect(m._layers.has('fachebene-kritis-buendel')).toBe(true);
  });

  it('entfernt Layer + Source', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    entferneFachebeneLayer(m as never, 'dwd');
    expect(m._sources.has(fachebeneSourceId('dwd'))).toBe(false);
    expect(m._layers.has('fachebene-dwd-fill')).toBe(false);
  });
});

describe('fachebeneClickLayerIds', () => {
  it('Polygon-Ebene → fill-Layer, Punkt-Ebene → circle-Layer', () => {
    expect(fachebeneClickLayerIds(FACHEBENEN.dwd)).toEqual(['fachebene-dwd-fill']);
    expect(fachebeneClickLayerIds(FACHEBENEN.pegelonline)).toEqual([
      'fachebene-pegelonline-circle',
    ]);
  });
  it('gebündelte Ebene → Einzelpunkt UND Bündel-Kreis sind anklickbar (LFH-83)', () => {
    expect(fachebeneClickLayerIds(FACHEBENEN.kritis)).toEqual([
      'fachebene-kritis-circle',
      'fachebene-kritis-buendel',
    ]);
  });
});

describe('entscheideFachebeneKlick', () => {
  it('Client-Bündel → hineinzoomen über die Cluster-ID (LFH-83)', () => {
    expect(entscheideFachebeneKlick(clientBuendel)).toEqual({ art: 'buendel', clusterId: 7 });
  });
  it('Server-Sammelpunkt → hineinzoomen um zwei Stufen, kein Detail-Panel (LFH-83)', () => {
    expect(entscheideFachebeneKlick(sammelpunkt)).toEqual({ art: 'sammelpunkt', zoomSchritt: 2 });
  });
  it('Einzelobjekt → Detailansicht wie bisher', () => {
    expect(entscheideFachebeneKlick(einzelobjekt)).toEqual({ art: 'einzel' });
  });
  it('fällt bei einem Bündel ohne lesbare Cluster-ID auf den Sammelpunkt-Weg zurück', () => {
    // Zoomen bleibt richtig, nur die exakte Stufe fehlt — besser als ein Detail-Panel für
    // ein Bündel.
    expect(entscheideFachebeneKlick({ cluster: true, point_count: 4 }).art).toBe('sammelpunkt');
  });
});

describe('kategorieLabel', () => {
  it('mappt bekannte Kategorien, Fallback auf Rohwert', () => {
    expect(kategorieLabel('krankenhaus')).toBe('Krankenhaus');
    expect(kategorieLabel('strom')).toBe('Umspannwerk');
    expect(kategorieLabel('odl')).toBe('ODL-Messsonde (BfS)');
    expect(kategorieLabel('unbekannt')).toBe('unbekannt');
  });
});
