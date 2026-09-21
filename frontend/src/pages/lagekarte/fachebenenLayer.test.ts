import { describe, it, expect, vi } from 'vitest';
import {
  sorgeFuerFachebeneLayer,
  entferneFachebeneLayer,
  fachebeneSourceId,
  fachebeneClickLayerId,
  kategorieLabel,
} from './fachebenenLayer';
import { FACHEBENEN } from './fachebenen';

function fakeMap() {
  const sources = new Set<string>();
  const layers = new Set<string>();
  const specs = new Map<
    string,
    { paint?: Record<string, unknown>; layout?: Record<string, unknown> }
  >();
  return {
    getSource: vi.fn((id: string) => (sources.has(id) ? {} : undefined)),
    addSource: vi.fn((id: string) => sources.add(id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    addLayer: vi.fn(
      (l: { id: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> }) => {
        layers.add(l.id);
        specs.set(l.id, l);
      },
    ),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    _sources: sources,
    _layers: layers,
    _specs: specs,
  };
}

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

  it('lässt MapLibre die Feature-ID aus dem Index vergeben (LFH-282)', () => {
    // Ohne `generateId` trägt das Klick-Feature keine ID; der Klick fiele still auf den
    // Punkt-in-Polygon-Rückfall zurück und überlappende Warnungen zeigten wieder keine oder
    // fremde Kennzahlen — ohne dass irgendwo etwas rot wird.
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    expect(m.addSource).toHaveBeenCalledWith(
      fachebeneSourceId('dwd'),
      expect.objectContaining({ type: 'geojson', generateId: true }),
    );
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

  it('entfernt Layer + Source', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    entferneFachebeneLayer(m as never, 'dwd');
    expect(m._sources.has(fachebeneSourceId('dwd'))).toBe(false);
    expect(m._layers.has('fachebene-dwd-fill')).toBe(false);
  });
});

describe('fachebeneClickLayerId', () => {
  it('Polygon-Ebene → fill-Layer, Punkt-Ebene → circle-Layer', () => {
    expect(fachebeneClickLayerId(FACHEBENEN.dwd)).toBe('fachebene-dwd-fill');
    expect(fachebeneClickLayerId(FACHEBENEN.pegelonline)).toBe('fachebene-pegelonline-circle');
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
