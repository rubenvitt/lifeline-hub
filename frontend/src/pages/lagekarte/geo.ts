export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: number[][];
}

export type GeoJsonGeometry = GeoJsonPolygon | GeoJsonLineString;

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

/** Liest eine Polygon- ODER LineString-Geometry aus einem GeoJSON-String; null sonst. */
export function parseGeometry(geojson: string | null | undefined): GeoJsonGeometry | null {
  if (!geojson) return null;
  try {
    const v = JSON.parse(geojson);
    if (v?.type === 'Polygon' && Array.isArray(v.coordinates)) return v as GeoJsonPolygon;
    if (v?.type === 'LineString' && Array.isArray(v.coordinates)) return v as GeoJsonLineString;
    return null;
  } catch {
    return null;
  }
}

// --- Metrische Kennzahlen (LFH-146) ----------------------------------------
// Rein clientseitig aus der GeoJSON-Geometrie. Bewusst ohne turf/geo-Lib (nicht im Repo).
// Die strikte GeoJsonGeometry-Union (Polygon|LineString) bleibt für den Draw-/Zonen-Pfad
// unverändert; MultiPolygon/MultiLineString werden NUR über die permissiven, losen
// Signaturen (geoKennzahlen/punktInPolygon/findeGeometrieAn) unterstützt.

const ERD_RADIUS_M = 6371000;
/** Meter pro Grad auf dem verwendeten Kugelmodell (≈ 111194,9 m) — für Projektion & Distanz gleich. */
const M_PRO_GRAD = (Math.PI / 180) * ERD_RADIUS_M;
const toRad = (grad: number) => (grad * Math.PI) / 180;

/** Großkreis-Distanz (Haversine) in Metern zwischen zwei [lon, lat]-Punkten. */
function haversineM([lon1, lat1]: number[], [lon2, lat2]: number[]): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * ERD_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Aufsummierte Länge eines Koordinaten-Zugs (Haversine) in Metern. */
function zugLaengeM(coords: number[][]): number {
  let s = 0;
  for (let i = 0; i < coords.length - 1; i++) s += haversineM(coords[i], coords[i + 1]);
  return s;
}

/** Vorzeichenbehaftete Shoelace-Fläche eines Rings in einer lokalen äquirektangularen Projektion. */
function shoelaceProjiziertM2(ring: number[][], refLat: number): number {
  const cos = Math.cos(toRad(refLat));
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lonA, latA] = ring[i];
    const [lonB, latB] = ring[i + 1];
    const xA = lonA * M_PRO_GRAD * cos, yA = latA * M_PRO_GRAD;
    const xB = lonB * M_PRO_GRAD * cos, yB = latB * M_PRO_GRAD;
    a += xA * yB - xB * yA;
  }
  return a / 2;
}

/** Fläche aus Ringen (Ring 0 = Außenring, weitere = Löcher, werden abgezogen). */
function ringeFlaecheM2(ringe: number[][][] | undefined): number {
  const aussen = ringe?.[0];
  if (!aussen || aussen.length < 4) return 0; // min. 3 Punkte + Schluss
  const refLat = aussen.reduce((s, p) => s + p[1], 0) / aussen.length;
  const betrag = (ring: number[][]) => Math.abs(shoelaceProjiziertM2(ring, refLat));
  let a = betrag(aussen);
  for (let i = 1; i < ringe!.length; i++) a -= betrag(ringe![i]);
  return Math.max(0, a);
}

/** Fläche eines Polygons in m² (Löcher abgezogen); 0 bei leer/entartet. */
export function polygonFlaecheM2(poly: GeoJsonPolygon): number {
  return ringeFlaecheM2(poly.coordinates);
}

/** Umfang des Außenrings eines Polygons in Metern (Haversine); 0 bei leer. */
export function polygonUmfangM(poly: GeoJsonPolygon): number {
  const ring = poly.coordinates?.[0];
  return ring && ring.length >= 2 ? zugLaengeM(ring) : 0;
}

/** Länge eines Linienzugs in Metern (Haversine); 0 bei <2 Punkten. */
export function lineLaengeM(line: GeoJsonLineString): number {
  return zugLaengeM(line.coordinates);
}

const nf = (maxNachkomma: number) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: maxNachkomma });

/** Fläche de-DE-lokalisiert mit Einheiten-Staffelung (m² < 1 ha < 1 km²). */
export function formatFlaeche(m2: number): string {
  if (m2 < 10_000) return `${nf(0).format(Math.round(m2))} m²`;
  if (m2 < 1_000_000) return `${nf(1).format(m2 / 10_000)} ha`;
  return `${nf(2).format(m2 / 1_000_000)} km²`;
}

/** Länge de-DE-lokalisiert (m < 1 km). */
export function formatLaenge(m: number): string {
  if (m < 1000) return `${nf(0).format(Math.round(m))} m`;
  return `${nf(1).format(m / 1000)} km`;
}

export interface GeoKennzahlen {
  flaecheM2?: number;
  umfangM?: number;
  laengeM?: number;
}

/** Lose Geometrie (auch Multi-*), wie sie von externen Fachebenen kommt. */
type LoseGeometrie = { type: string; coordinates: unknown };

/**
 * Kennzahlen aus einer (auch losen) Geometrie: Polygon→Fläche+Umfang,
 * MultiPolygon→summiert, LineString→Länge, MultiLineString→summiert, sonst null.
 */
export function geoKennzahlen(geom: LoseGeometrie | null | undefined): GeoKennzahlen | null {
  if (!geom) return null;
  switch (geom.type) {
    case 'Polygon': {
      const poly = geom as GeoJsonPolygon;
      return { flaecheM2: polygonFlaecheM2(poly), umfangM: polygonUmfangM(poly) };
    }
    case 'MultiPolygon': {
      let flaecheM2 = 0, umfangM = 0;
      for (const ringe of geom.coordinates as number[][][][]) {
        flaecheM2 += ringeFlaecheM2(ringe);
        const aussen = ringe?.[0];
        if (aussen && aussen.length >= 2) umfangM += zugLaengeM(aussen);
      }
      return { flaecheM2, umfangM };
    }
    case 'LineString':
      return { laengeM: lineLaengeM(geom as GeoJsonLineString) };
    case 'MultiLineString':
      return { laengeM: (geom.coordinates as number[][][]).reduce((s, l) => s + zugLaengeM(l), 0) };
    default:
      return null;
  }
}

type PunktLngLat = { lng: number; lat: number };

/** Ray-Casting: liegt der Punkt in diesem einzelnen Ring? */
function imRing(ring: number[][], p: PunktLngLat): boolean {
  let drin = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi
    ) {
      drin = !drin;
    }
  }
  return drin;
}

/** even-odd über alle Ringe: Außenring zählt, Loch zieht wieder ab. */
function ringeEnthalten(ringe: number[][][], p: PunktLngLat): boolean {
  let drin = false;
  for (const ring of ringe) if (imRing(ring, p)) drin = !drin;
  return drin;
}

/** Enthält ein Polygon/MultiPolygon den Punkt? (even-odd, respektiert Löcher). */
export function punktInPolygon(p: PunktLngLat, geom: LoseGeometrie): boolean {
  if (geom.type === 'Polygon') return ringeEnthalten(geom.coordinates as number[][][], p);
  if (geom.type === 'MultiPolygon')
    return (geom.coordinates as number[][][][]).some((ringe) => ringeEnthalten(ringe, p));
  return false;
}

type FeatureCollectionLike = { features: { geometry: LoseGeometrie | null }[] };

/**
 * Volle Geometrie des ersten Features, dessen Polygon/MultiPolygon den Punkt enthält; sonst null.
 * Für LFH-146 (c): die un-geclippte Fachebenen-Geometrie aus der geladenen FeatureCollection
 * beziehen statt des kachel-geclippten Klick-Features.
 *
 * Bekannte Limitierung (Review LFH-209): bei mehreren an der Klickstelle ÜBERLAPPENDEN Features
 * (z. B. gleichzeitige Gewitter- + Dauerregen-Warnung über demselben Gebiet) liefert dies das
 * erste enthaltende Feature der Collection-Reihenfolge — die im Panel gezeigten Properties stammen
 * aber vom obersten gerenderten Feature. Dann können Kennzahlen und Text divergieren. Robusterer
 * Weg (Follow-up): Match über eine stabile Feature-ID des Klick-Features statt First-Point-in-Polygon.
 */
export function findeGeometrieAn(p: PunktLngLat, collection: FeatureCollectionLike): LoseGeometrie | null {
  for (const f of collection.features) {
    const g = f?.geometry;
    if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && punktInPolygon(p, g)) return g;
  }
  return null;
}
