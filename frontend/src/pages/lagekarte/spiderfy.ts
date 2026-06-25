// Pixel-Offsets zum Auffächern (Spiderfy) der Cluster-Leaves. Pure & jsdom-testbar — nur
// Geometrie, kein MapLibre. Kreis bis SPIDER_KREIS_MAX Leaves, danach Archimedische Spirale.

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
