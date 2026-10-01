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
    setPaintProperty: vi.fn((id: string, name: string, wert: unknown) => {
      const spec = specs.get(id);
      if (spec) spec.paint = { ...spec.paint, [name]: wert };
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

/** Die Ebenenfarbe kommt vom Aufrufer (`fachebeneFarbe`, LFH-593) — ein Wert, den keine Ebene hat. */
const FARBE = '#123456';
/** Durchmesser der Trefferzone (`token.controlHeight`, LFH-600) — ein Wert, den keine Stufe hat. */
const TREFFER = 50;

interface LayerSpec {
  id: string;
  type?: string;
  filter?: unknown;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

/**
 * Wertet den Teil der MapLibre-Filtersprache aus, den die Fachebenen nutzen (`any`, `all`, `!`,
 * `has`). Ohne Auswertung prüfte der Test nur die Schreibweise — ein vertauschtes `any`/`all` sähe
 * gegen ein ebenso vertauschtes Literal grün aus.
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
    case '==':
      return wert(args[0], props) === wert(args[1], props);
    case '!=':
      return wert(args[0], props) !== wert(args[1], props);
    default:
      throw new Error(`Filter-Operator ${op} im Test nicht ausgewertet`);
  }
}

/**
 * Wert eines Ausdrucks: `['get', k]`, `['geometry-type']` (aus `__geometrie`, sonst `Polygon`),
 * `['case', bedingung, dann, sonst]` oder ein Literal.
 */
function wert(ausdruck: unknown, props: Record<string, unknown>): unknown {
  if (!Array.isArray(ausdruck)) return ausdruck;
  const [op, ...args] = ausdruck as [string, ...unknown[]];
  switch (op) {
    case 'get':
      return props[args[0] as string];
    case 'geometry-type':
      return props.__geometrie ?? 'Polygon';
    case 'case':
      return passt(args[0], props) ? wert(args[1], props) : wert(args[2], props);
    default:
      throw new Error(`Ausdruck ${op} im Test nicht ausgewertet`);
  }
}

// Die drei Feature-Arten der KRITIS-Source (Server-Sammelpunkt, Client-Bündel, Einzelobjekt).
const clientBuendel = { cluster: true, cluster_id: 7, point_count: 3, anzahl: 1203 };
const sammelpunkt = { sammelpunkt: true, anzahl: 1200 };
const einzelobjekt = { titel: 'Klinikum', kategorie: 'krankenhaus' };

const leer = { type: 'FeatureCollection', features: [] } as const;

describe('fachebenenLayer', () => {
  it('legt Source + Polygon-Layer für DWD an (idempotent)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never, FARBE, TREFFER);
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never, FARBE, TREFFER);
    expect(m._sources.has(fachebeneSourceId('dwd'))).toBe(true);
    expect(m._layers.has('fachebene-dwd-fill')).toBe(true);
    expect(m._layers.has('fachebene-dwd-line')).toBe(true);
    // nur einmal angelegt
    expect(m.addSource).toHaveBeenCalledTimes(1);
  });

  it('färbt bestehende Layer beim Moduswechsel um, ohne sie neu anzulegen (LFH-593)', () => {
    // Die Layer entstehen einmal; ein Wechsel Tag ↔ Nacht ohne neuen Kartenstil (Karten-Theme
    // überschrieben) liefe sonst mit dem alten Ton weiter.
    const NACHT = '#654321';
    for (const def of [FACHEBENEN.dwd, FACHEBENEN.pegelonline, FACHEBENEN.kritis]) {
      const m = fakeMap();
      sorgeFuerFachebeneLayer(m as never, def, leer as never, FARBE, TREFFER);
      const angelegt = m.addLayer.mock.calls.length;
      sorgeFuerFachebeneLayer(m as never, def, leer as never, NACHT, TREFFER);
      expect(m.addLayer).toHaveBeenCalledTimes(angelegt);
      // Die Kante ist Kontur, keine Ebenenfarbe (LFH-600) — sie bleibt bei jedem Modus schwarz.
      const farben = [...m._specs.values()]
        .filter((l) => !l.id.endsWith('-kante'))
        .flatMap((l) =>
          Object.entries(l.paint ?? {})
            .filter(([k]) => ['fill-color', 'line-color', 'circle-color'].includes(k))
            .map(([, v]) => JSON.stringify(v)),
        );
      expect(farben.length, def.key).toBeGreaterThan(0);
      for (const f of farben) {
        expect(f, def.key).toContain(NACHT);
        expect(f, def.key).not.toContain(FARBE);
      }
    }
  });

  it('lässt MapLibre die Feature-ID aus dem Index vergeben (LFH-282)', () => {
    // Ohne `generateId` trägt das Klick-Feature keine ID; überlappende Warnungen zeigten dann keine
    // oder fremde Kennzahlen, ohne dass etwas rot wird.
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never, FARBE, TREFFER);
    expect(m.addSource).toHaveBeenCalledWith(
      fachebeneSourceId('dwd'),
      expect.objectContaining({ type: 'geojson', generateId: true }),
    );
  });

  it('legt Circle-Layer für Punkt-Ebene (pegelonline) an', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.pegelonline, leer as never, FARBE, TREFFER);
    expect(m._layers.has('fachebene-pegelonline-circle')).toBe(true);
  });

  it('lässt das Feature über Farbe und Radius bestimmen, mit der Ebenenfarbe als Rückfall', () => {
    // Die Hochwasserebene backt Farbe und Radius je Pegelklasse in die Properties. Ein fester
    // `circle-color`/`circle-radius` verwürfe sie still; Ebenen ohne die Properties fallen auf ihre
    // Farbe zurück.
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.pegelonline, leer as never, FARBE, TREFFER);
    const paint = m._specs.get('fachebene-pegelonline-circle')?.paint;
    expect(paint?.['circle-color']).toEqual(['coalesce', ['get', 'farbe'], FARBE]);
    expect(paint?.['circle-radius']).toEqual(['coalesce', ['get', 'radius'], 5]);
  });

  it('zeichnet größere Punkte über kleinere — eine erhöhte Sonde verschwindet nicht (LFH-78)', () => {
    // Ohne Sortierschlüssel legte sich bei dicht stehenden ODL-Sonden ein später gezeichneter
    // kleiner Nachbar über einen großen `stark_erhoeht`-Punkt. Der Radius ist die Stufe, also
    // sortiert er auch.
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.odl, leer as never, FARBE, TREFFER);
    const layout = m._specs.get('fachebene-odl-circle')?.layout;
    expect(layout?.['circle-sort-key']).toEqual(['coalesce', ['get', 'radius'], 0]);
  });

  it('legt KRITIS als gebündelte Source an, die Sammelpunkte mit Gewicht zählt (LFH-83)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    // Zweiter Lauf (Re-Anlage nach setStyle): Source-Optionen greifen nur beim Anlegen.
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    expect(m.addSource).toHaveBeenCalledTimes(1);
    const opt = m._sourceOptionen.get(fachebeneSourceId('kritis'));
    expect(opt).toMatchObject({ type: 'geojson', cluster: true, clusterMaxZoom: 14 });
    expect(opt?.clusterRadius).toBeGreaterThanOrEqual(40);
    expect(opt?.clusterRadius).toBeLessThanOrEqual(60);
    // Ein Server-Sammelpunkt zählt mit seiner `anzahl`, ein Einzelobjekt mit 1.
    expect(opt?.clusterProperties).toEqual({
      anzahl: ['+', ['coalesce', ['get', 'anzahl'], 1]],
    });
  });

  it('bündelt nur die Ebenen mit `buendeln` — die übrigen Punktebenen bleiben ungebündelt', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.odl, leer as never, FARBE, TREFFER);
    expect(m._sourceOptionen.get(fachebeneSourceId('odl'))?.cluster).toBeUndefined();
    expect(m._layers.has('fachebene-odl-buendel')).toBe(false);
  });

  it('teilt die KRITIS-Features überschneidungsfrei auf Bündel und Einzelpunkt auf (LFH-83)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    const kreis = m._specs.get('fachebene-kritis-buendel')!;
    const zahl = m._specs.get('fachebene-kritis-buendel-zahl')!;
    const einzel = m._specs.get('fachebene-kritis-circle')!;
    expect(kreis.type).toBe('circle');
    expect(zahl.type).toBe('symbol');
    expect(einzel.type).toBe('circle');
    // Ein allein stehender Server-Sammelpunkt ist kein MapLibre-Bündel, wird aber genauso
    // gezeichnet.
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
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    const zahl = m._specs.get('fachebene-kritis-buendel-zahl')!;
    const feld = JSON.stringify(zahl.layout?.['text-field']);
    // `anzahl` trägt Clustersumme und Zahl eines Sammelpunkts; `point_count` fehlte beim
    // Sammelpunkt.
    expect(feld).toContain('"anzahl"');
    // Die einzige Schrift, die der Offline-Style ausliefert (assets/karten/fonts/).
    expect(zahl.layout?.['text-font']).toEqual(['Noto Sans Regular']);
    // Überdeckung: die Zahl gehört auf ihren Kreis, nicht verdrängt von einer Nachbarzahl.
    expect(zahl.layout?.['text-allow-overlap']).toBe(true);
  });

  it('zeichnet die Bündel in der Ebenenfarbe mit Kontur und Text/Halo aus den Tokens (LFH-83)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    const kreis = m._specs.get('fachebene-kritis-buendel')!.paint!;
    const zahl = m._specs.get('fachebene-kritis-buendel-zahl')!.paint!;
    expect(kreis['circle-color']).toBe(FARBE);
    expect(kreis['circle-stroke-color']).toBe(farbenHell.flaeche);
    expect(zahl['text-color']).toBe(farbenHell.flaeche);
    expect(zahl['text-halo-color']).toBe(farbenHell.text);
  });

  it('legt die Zahl über ihren Kreis (Zeichenreihenfolge)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    expect(m._reihenfolge.indexOf('fachebene-kritis-buendel-zahl')).toBeGreaterThan(
      m._reihenfolge.indexOf('fachebene-kritis-buendel'),
    );
  });

  it('räumt beim Entfernen alle drei KRITIS-Layer und die Source (idempotent)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    entferneFachebeneLayer(m as never, 'kritis');
    entferneFachebeneLayer(m as never, 'kritis');
    expect(m._layers.size).toBe(0);
    expect(m._sources.size).toBe(0);
    // Wieder anlegen geht — keine Leiche, an der `addLayer` mit „already exists" scheiterte.
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    expect(m._layers.has('fachebene-kritis-buendel')).toBe(true);
  });

  it('entfernt Layer + Source', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never, FARBE, TREFFER);
    entferneFachebeneLayer(m as never, 'dwd');
    expect(m._sources.has(fachebeneSourceId('dwd'))).toBe(false);
    expect(m._layers.has('fachebene-dwd-fill')).toBe(false);
  });
});

describe('angekündigte Warnungen auf Polygon-Ebenen (LFH-662)', () => {
  const geltend = { EVENT: 'STURM' };
  const angekuendigt = { EVENT: 'FROST', angekuendigt: true };
  const zeichnet = (spec: LayerSpec | undefined, props: Record<string, unknown>) =>
    passt(spec?.filter, props);

  function dwdKarte() {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never, FARBE, TREFFER);
    return m;
  }

  it('zeichnet die Kontur einer angekündigten Warnung gestrichelt, die einer geltenden durchgezogen', () => {
    const m = dwdKarte();
    const voll = m._specs.get('fachebene-dwd-line');
    const gestrichelt = m._specs.get('fachebene-dwd-line-angekuendigt');
    expect(gestrichelt?.type).toBe('line');
    expect(gestrichelt?.paint?.['line-dasharray']).toEqual([3, 2]);
    expect(voll?.paint?.['line-dasharray']).toBeUndefined();
    // Jede Warnung bekommt genau eine Kontur.
    expect([zeichnet(voll, geltend), zeichnet(gestrichelt, geltend)]).toEqual([true, false]);
    expect([zeichnet(voll, angekuendigt), zeichnet(gestrichelt, angekuendigt)]).toEqual([
      false,
      true,
    ]);
    // Nur Polygone, wie die übrigen Flächenebenen.
    expect(zeichnet(gestrichelt, { ...angekuendigt, __geometrie: 'Point' })).toBe(false);
  });

  it('füllt eine angekündigte Warnung schwächer als eine geltende', () => {
    const deckkraft = m(dwdKarte());
    function m(k: ReturnType<typeof fakeMap>) {
      const d = k._specs.get('fachebene-dwd-fill')?.paint?.['fill-opacity'];
      return (props: Record<string, unknown>) => wert(d, props) as number;
    }
    expect(deckkraft(geltend)).toBe(0.2);
    expect(deckkraft(angekuendigt)).toBe(0.08);
    expect(deckkraft(angekuendigt)).toBeLessThan(deckkraft(geltend));
  });

  it('legt die gestrichelte Kontur über die Fläche und räumt sie beim Entfernen mit', () => {
    const m = dwdKarte();
    expect(m._reihenfolge.indexOf('fachebene-dwd-line-angekuendigt')).toBeGreaterThan(
      m._reihenfolge.indexOf('fachebene-dwd-fill'),
    );
    entferneFachebeneLayer(m as never, 'dwd');
    expect(m._layers.size).toBe(0);
  });

  it('die gestrichelte Kontur ist keine Klickebene — geklickt wird die Fläche', () => {
    expect(fachebeneClickLayerIds(FACHEBENEN.dwd)).toEqual(['fachebene-dwd-fill']);
  });
});

describe('fachebeneClickLayerIds', () => {
  it('Polygon-Ebene → fill-Layer, Punkt-Ebene → circle-Layer und Trefferzone (LFH-600)', () => {
    expect(fachebeneClickLayerIds(FACHEBENEN.dwd)).toEqual(['fachebene-dwd-fill']);
    expect(fachebeneClickLayerIds(FACHEBENEN.pegelonline)).toEqual([
      'fachebene-pegelonline-circle',
      'fachebene-pegelonline-treffer',
    ]);
  });
  it('gebündelte Ebene → Einzelpunkt, Bündel-Kreis und Trefferzone sind anklickbar (LFH-83/600)', () => {
    expect(fachebeneClickLayerIds(FACHEBENEN.kritis)).toEqual([
      'fachebene-kritis-circle',
      'fachebene-kritis-buendel',
      'fachebene-kritis-treffer',
    ]);
  });
  it('jede Klickebene ist auch eine angelegte Ebene', () => {
    for (const def of Object.values(FACHEBENEN)) {
      const m = fakeMap();
      sorgeFuerFachebeneLayer(m as never, def, leer as never, FARBE, TREFFER);
      for (const id of fachebeneClickLayerIds(def)) expect(m._layers.has(id), id).toBe(true);
    }
  });
});

/**
 * LFH-600: Die Trefffläche ist vom gezeichneten Kreis getrennt (Radius = Stufe), und eine
 * Doppelkante weiß/schwarz trägt die Kontur gegen jeden Kartengrund.
 */
describe('Trefferzone und Kante der Punkt-Fachebenen (LFH-600)', () => {
  const punktEbenen = Object.values(FACHEBENEN).filter((d) => d.geometrieTyp === 'punkt');
  const kreisRadius = ['coalesce', ['get', 'radius'], 5];

  it('es gibt Punkt-Ebenen mit und ohne Bündel — sonst prüften die Schleifen nur eine Sorte', () => {
    expect(punktEbenen.some((d) => d.buendeln)).toBe(true);
    expect(punktEbenen.some((d) => !d.buendeln)).toBe(true);
  });

  it('legt je Punkt-Ebene eine unsichtbare Trefferzone ohne Filter mit halbem Staffelwert an', () => {
    for (const def of punktEbenen) {
      const m = fakeMap();
      sorgeFuerFachebeneLayer(m as never, def, leer as never, FARBE, TREFFER);
      const zone = m._specs.get(`fachebene-${def.key}-treffer`);
      expect(zone?.type, def.key).toBe('circle');
      // Ohne Filter: Einzelpunkt, Client-Bündel und Server-Sammelpunkt tragen dieselbe Zone.
      expect(zone?.filter, def.key).toBeUndefined();
      expect(zone?.paint?.['circle-radius'], def.key).toBe(TREFFER / 2);
      expect(zone?.paint?.['circle-opacity'], def.key).toBe(0);
      expect(zone?.paint?.['circle-stroke-width'], def.key).toBe(0);
    }
  });

  it('Trefferzone unter Kante unter Kreis; beim Bündel Kante unter Bündelkreis', () => {
    for (const def of punktEbenen) {
      const m = fakeMap();
      sorgeFuerFachebeneLayer(m as never, def, leer as never, FARBE, TREFFER);
      const i = (s: string) => m._reihenfolge.indexOf(`fachebene-${def.key}-${s}`);
      expect(i('treffer'), def.key).toBeGreaterThanOrEqual(0);
      expect(i('treffer'), def.key).toBeLessThan(i('kante'));
      expect(i('kante'), def.key).toBeLessThan(i('circle'));
      if (def.buendeln) {
        expect(i('treffer')).toBeLessThan(i('buendel-kante'));
        expect(i('buendel-kante')).toBeLessThan(i('buendel'));
      } else {
        expect(m._layers.has(`fachebene-${def.key}-buendel-kante`), def.key).toBe(false);
      }
    }
  });

  it('Polygon-Ebenen bekommen weder Trefferzone noch Kante', () => {
    for (const def of Object.values(FACHEBENEN).filter((d) => d.geometrieTyp === 'polygon')) {
      const m = fakeMap();
      sorgeFuerFachebeneLayer(m as never, def, leer as never, FARBE, TREFFER);
      expect(
        [...m._layers].filter((id) => /-(treffer|kante)$/.test(id)),
        def.key,
      ).toEqual([]);
    }
  });

  it('ein Dichtewechsel zieht den Radius der Zone nach, ohne Layer neu anzulegen', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    const angelegt = m.addLayer.mock.calls.length;
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, 72);
    expect(m.addLayer).toHaveBeenCalledTimes(angelegt);
    expect(m._specs.get('fachebene-kritis-treffer')?.paint?.['circle-radius']).toBe(36);
  });

  it('die Kante ist schwarz, 4 px größer als das Zeichen und sortiert wie der Kreis', () => {
    for (const def of punktEbenen) {
      const m = fakeMap();
      sorgeFuerFachebeneLayer(m as never, def, leer as never, FARBE, TREFFER);
      const kante = m._specs.get(`fachebene-${def.key}-kante`)!;
      const kreis = m._specs.get(`fachebene-${def.key}-circle`)!;
      expect(kante.paint?.['circle-color'], def.key).toBe('#000');
      expect(kante.paint?.['circle-radius'], def.key).toEqual(['+', kreisRadius, 4]);
      expect(kante.layout?.['circle-sort-key'], def.key).toEqual(kreis.layout?.['circle-sort-key']);
      // Dieselben Features wie der Kreis — eine Kante ohne Zeichen oder ein Zeichen ohne Kante
      // wäre eine Lücke.
      expect(kante.filter, def.key).toEqual(kreis.filter);
    }
  });

  it('der Radius des Zeichens bleibt die Stufe, der weiße Rand ist 2 px', () => {
    for (const def of punktEbenen) {
      const m = fakeMap();
      sorgeFuerFachebeneLayer(m as never, def, leer as never, FARBE, 72);
      const kreis = m._specs.get(`fachebene-${def.key}-circle`)!.paint!;
      expect(kreis['circle-radius'], def.key).toEqual(kreisRadius);
      expect(kreis['circle-stroke-color'], def.key).toBe('#fff');
      expect(kreis['circle-stroke-width'], def.key).toBe(2);
    }
  });

  it('das Bündel trägt dieselbe Doppelkante', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.kritis, leer as never, FARBE, TREFFER);
    const buendel = m._specs.get('fachebene-kritis-buendel')!;
    const kante = m._specs.get('fachebene-kritis-buendel-kante')!;
    expect(buendel.paint?.['circle-stroke-width']).toBe(2);
    expect(kante.paint?.['circle-color']).toBe('#000');
    expect(kante.paint?.['circle-radius']).toEqual(['+', buendel.paint?.['circle-radius'], 4]);
    expect(kante.filter).toEqual(buendel.filter);
  });

  it('räumt Trefferzone und Kanten beim Entfernen mit', () => {
    for (const def of punktEbenen) {
      const m = fakeMap();
      sorgeFuerFachebeneLayer(m as never, def, leer as never, FARBE, TREFFER);
      entferneFachebeneLayer(m as never, def.key);
      expect([...m._layers], def.key).toEqual([]);
    }
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
    // Zoomen bleibt richtig, nur die exakte Stufe fehlt — besser als ein Detail-Panel für ein
    // Bündel.
    expect(entscheideFachebeneKlick({ cluster: true, point_count: 4 }).art).toBe('sammelpunkt');
  });
});

describe('kategorieLabel', () => {
  it('mappt bekannte Kategorien, Fallback auf Rohwert', () => {
    expect(kategorieLabel('krankenhaus')).toBe('Krankenhaus');
    expect(kategorieLabel('strom')).toBe('Umspannwerk');
    expect(kategorieLabel('odl')).toBe('ODL-Messsonde (BfS)');
    expect(kategorieLabel('unbekannt')).toBe('unbekannt');
    // Kategorie der Luftqualitätsebene (LFH-79, gesetzt in karte::luftqualitaet).
    expect(kategorieLabel('luftmessstation')).toBe('Luftmessstation');
  });
});
