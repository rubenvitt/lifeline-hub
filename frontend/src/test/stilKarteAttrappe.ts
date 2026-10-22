import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Attrappe des Stil-Ausschnitts einer maplibre-Karte (LLH-1345): Quellen und Ebenen im Speicher,
 * in der Reihenfolge, die `addLayer(…, vor)` ergäbe. Für Vorschau-Ebenen, die ein Test anlegen
 * und abbauen sieht, ohne WebGL.
 */
export interface StilEbene {
  id: string;
  type?: string;
  source?: string;
  paint?: Record<string, unknown>;
}

export interface StilKarteAttrappe {
  map: MapLibreMap;
  /** Die zuletzt eingespielten Daten je Quelle. */
  quellen: Map<string, unknown>;
  /** Ebenen von unten nach oben. */
  ebenen: StilEbene[];
  ids: () => string[];
}

/** `vorhandene`: Ebenen, die schon auf der Karte liegen (unten nach oben), etwa die von terra-draw. */
export function stilKarteAttrappe(vorhandene: string[] = []): StilKarteAttrappe {
  const canvas = document.createElement('canvas');
  const quellen = new Map<string, unknown>();
  const ebenen: StilEbene[] = vorhandene.map((id) => ({ id }));
  const index = (id: string) => ebenen.findIndex((e) => e.id === id);
  const map = {
    getCanvas: () => canvas,
    getSource: (id: string) =>
      quellen.has(id) ? { setData: (daten: unknown) => quellen.set(id, daten) } : undefined,
    addSource: (id: string, quelle: { data: unknown }) => {
      if (quellen.has(id)) throw new Error(`Quelle ${id} gibt es schon`);
      quellen.set(id, quelle.data);
    },
    removeSource: (id: string) => {
      if (ebenen.some((e) => e.source === id)) throw new Error(`Quelle ${id} ist noch in Gebrauch`);
      quellen.delete(id);
    },
    getLayer: (id: string) => ebenen.find((e) => e.id === id),
    addLayer: (ebene: StilEbene, vor?: string) => {
      if (index(ebene.id) >= 0) throw new Error(`Ebene ${ebene.id} gibt es schon`);
      if (ebene.source && !quellen.has(ebene.source))
        throw new Error(`Quelle ${ebene.source} fehlt`);
      const i = vor ? index(vor) : -1;
      if (vor && i < 0) throw new Error(`Ebene ${vor} fehlt`);
      if (i < 0) ebenen.push({ ...ebene, paint: { ...ebene.paint } });
      else ebenen.splice(i, 0, { ...ebene, paint: { ...ebene.paint } });
    },
    removeLayer: (id: string) => {
      const i = index(id);
      if (i < 0) throw new Error(`Ebene ${id} fehlt`);
      ebenen.splice(i, 1);
    },
    setPaintProperty: (id: string, eigenschaft: string, wert: unknown) => {
      const ebene = ebenen[index(id)];
      ebene.paint = { ...ebene.paint, [eigenschaft]: wert };
    },
    getStyle: () => ({ layers: ebenen.map((e) => ({ id: e.id })) }),
  } as unknown as MapLibreMap;
  return { map, quellen, ebenen, ids: () => ebenen.map((e) => e.id) };
}
