export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

/** Flächengewichteter Zentroid des äußeren Rings; null bei leerem/degeneriertem Polygon. */
export function polygonZentroid(poly: GeoJsonPolygon): [number, number] | null {
  const ring = poly.coordinates?.[0];
  if (!ring || ring.length < 4) return null; // mind. 3 Punkte + Schluss
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (a === 0) {
    // entartet (kollinear) → Mittel der Stützpunkte
    const pts = ring.slice(0, -1);
    const sx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const sy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [sx, sy];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

export function parsePolygon(geojson: string | null | undefined): GeoJsonPolygon | null {
  if (!geojson) return null;
  try {
    const v = JSON.parse(geojson);
    return v?.type === 'Polygon' && Array.isArray(v.coordinates) ? (v as GeoJsonPolygon) : null;
  } catch {
    return null;
  }
}
