// Pixel-Offsets zum Auffächern (Spiderfy) der Cluster-Leaves. Pure & jsdom-testbar — nur
// Geometrie, kein MapLibre. Kreis bis SPIDER_KREIS_MAX Leaves, danach Archimedische Spirale.

import type { MarkerProps, MarkerFeature, MarkerFeatureCollection } from './markerLayer';

export interface SpiderOffset {
  x: number;
  y: number;
}

/** Mehr Leaves als das → Zoom-Fallback statt Spider (markerLayer/Kartenflaeche). */
export const SPIDER_CAP = 12;
/** Mindestabstand benachbarter Symbole in Pixeln (Icon-Zielgröße 34px + Puffer). */
export const SPIDER_LEAF_ABSTAND = 40;
const SPIDER_KREIS_MAX = 9;

function kreis(count: number): SpiderOffset[] {
  // Radius so groß, dass die Sehne zwischen Nachbarn ≥ SPIDER_LEAF_ABSTAND ist.
  const r = Math.max(SPIDER_LEAF_ABSTAND, SPIDER_LEAF_ABSTAND / (2 * Math.sin(Math.PI / count)));
  const res: SpiderOffset[] = [];
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count - Math.PI / 2; // Start oben
    res.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return res;
}

function spirale(count: number): SpiderOffset[] {
  // Archimedisch: Windungsabstand 2*pi*b = SPIDER_LEAF_ABSTAND; Schrittwinkel so, dass die
  // Bogenlänge je Schritt ~ SPIDER_LEAF_ABSTAND bleibt → Nachbarn ≥ Icon-Größe auseinander.
  const b = SPIDER_LEAF_ABSTAND / (2 * Math.PI);
  const res: SpiderOffset[] = [];
  let winkel = 0;
  for (let i = 0; i < count; i++) {
    const r = SPIDER_LEAF_ABSTAND + b * winkel;
    res.push({ x: r * Math.cos(winkel - Math.PI / 2), y: r * Math.sin(winkel - Math.PI / 2) });
    winkel += SPIDER_LEAF_ABSTAND / r;
  }
  return res;
}

/** Pixel-Offsets für `count` Leaves relativ zum Cluster-Mittelpunkt. */
export function spiderfyOffsets(count: number): SpiderOffset[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: -SPIDER_LEAF_ABSTAND }];
  if (count <= SPIDER_KREIS_MAX) return kreis(count);
  return spirale(count);
}

export interface SpiderProjektor {
  project(lngLat: [number, number]): { x: number; y: number };
  unproject(px: { x: number; y: number }): { lng: number; lat: number };
}

export type SpiderLegFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }>;
};

export interface SpiderFcs {
  leaves: MarkerFeatureCollection;
  legs: SpiderLegFeatureCollection;
}

/**
 * Baut aus den Cluster-Leaves die aufgefächerten Leaf-Punkte (unveränderte MarkerProps) und die
 * Beinchen-Linien. Der Anker wird in den Pixelraum projiziert, die Offsets addiert und zurück
 * un-projiziert → die Symbole sitzen mit festem Pixelabstand um den Cluster-Mittelpunkt.
 * Der Projektor ist injiziert (= `map.project`/`map.unproject`) → pure & testbar.
 */
export function baueSpiderFc(
  leaves: MarkerProps[],
  anker: [number, number],
  projektor: SpiderProjektor,
): SpiderFcs {
  const offsets = spiderfyOffsets(leaves.length);
  const c = projektor.project(anker);
  const leafFeatures: MarkerFeature[] = [];
  const legFeatures: SpiderLegFeatureCollection['features'] = [];
  leaves.forEach((p, i) => {
    const o = offsets[i];
    const ll = projektor.unproject({ x: c.x + o.x, y: c.y + o.y });
    const pos: [number, number] = [ll.lng, ll.lat];
    leafFeatures.push({ type: 'Feature', properties: { ...p }, geometry: { type: 'Point', coordinates: pos } });
    legFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [anker, pos] } });
  });
  return {
    leaves: { type: 'FeatureCollection', features: leafFeatures },
    legs: { type: 'FeatureCollection', features: legFeatures },
  };
}
