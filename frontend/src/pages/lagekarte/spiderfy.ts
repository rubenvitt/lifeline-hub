// Pixel-Offsets zum Auffächern (Spiderfy) der Cluster-Leaves — reine Geometrie, kein MapLibre.
// Kreis bis SPIDER_KREIS_MAX Leaves, danach Archimedische Spirale.

import type { MarkerProps, MarkerFeature, MarkerFeatureCollection } from './markerLayer';

interface SpiderOffset {
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

type SpiderLegFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }>;
};

interface SpiderFcs {
  leaves: MarkerFeatureCollection;
  legs: SpiderLegFeatureCollection;
}

/**
 * Baut aus den Cluster-Leaves die aufgefächerten Leaf-Punkte (unveränderte MarkerProps) und die
 * Beinchen-Linien: Anker in den Pixelraum projizieren, Offsets addieren, zurückprojizieren. Der
 * Projektor (`map.project`/`map.unproject`) ist injiziert.
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
    leafFeatures.push({
      type: 'Feature',
      properties: { ...p },
      geometry: { type: 'Point', coordinates: pos },
    });
    legFeatures.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [anker, pos] },
    });
  });
  return {
    leaves: { type: 'FeatureCollection', features: leafFeatures },
    legs: { type: 'FeatureCollection', features: legFeatures },
  };
}

/**
 * Hat sich an den clusterbaren Markern nur der INHALT geändert — gleiche Schlüssel in gleicher
 * Folge an gleicher Lage? Dann bildet die Clusterquelle dieselben Bündel, und ein offener Spider
 * darf stehen bleiben (LFH-668, `openspec/changes/archive/2026-10-01-lfh-668-betroffenen-karte-schleuse/design.md`,
 * D5). Die Folge zählt mit: von ihr hängen die Bündel-Kennungen ab.
 */
export function nurInhaltGeaendert(
  alt: MarkerFeatureCollection,
  neu: MarkerFeatureCollection,
): boolean {
  if (alt.features.length !== neu.features.length) return false;
  return alt.features.every((a, i) => {
    const n = neu.features[i];
    return (
      a.properties.schluessel === n.properties.schluessel &&
      a.geometry.coordinates[0] === n.geometry.coordinates[0] &&
      a.geometry.coordinates[1] === n.geometry.coordinates[1]
    );
  });
}

/**
 * Schreibt die Eigenschaften aufgefächerter Blätter neu, ohne sie zu bewegen: jedes Blatt behält
 * seine Lage und nimmt die Eigenschaften des neuen Merkmals mit demselben `schluessel`. Synchron,
 * damit zwischen altem und neuem Stand kein Bild ohne Blätter liegt (D5).
 */
export function aktualisiereSpiderBlaetter(
  blaetter: MarkerFeatureCollection,
  neu: MarkerFeatureCollection,
): MarkerFeatureCollection {
  const nach = new Map(neu.features.map((f) => [f.properties.schluessel, f.properties]));
  return {
    type: 'FeatureCollection',
    features: blaetter.features.map((f) => {
      const properties = nach.get(f.properties.schluessel);
      return properties ? { ...f, properties: { ...properties } } : f;
    }),
  };
}
