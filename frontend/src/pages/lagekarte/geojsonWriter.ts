/**
 * GeoJSON-Schreiber des Lagekarten-Exports (Zunder A, Entwurf
 * `docs/superpowers/specs/2026-11-24-k9tkgrou-lagekarte-geo-export-design.md`, „Ein Zwischenmodell,
 * zwei Schreiber“). Reine Funktion über das Zwischenmodell aus `geoExport.ts`.
 *
 * - **Simplestyle** (`marker-color`, `stroke`, `stroke-width`, `stroke-opacity`, `fill`,
 *   `fill-opacity`) plus `lfh:`-Felder; Felder ohne Wert fehlen, nie `null`.
 * - **Wurzel:** `lfh:stand` in UTC (`YYYY-MM-DD HH:MM:SS`, ADR-0012) und `lfh:quelle`; kein `crs`
 *   (RFC 7946: immer WGS 84).
 * - Medientyp `application/geo+json`, Endung `.geojson`.
 */
import { schliesseRing, type ExportGeometrie, type ExportObjekt } from './geoExport';

export const GEOJSON_MEDIENTYP = 'application/geo+json';
export const GEOJSON_ENDUNG = 'geojson';

/** UTC `YYYY-MM-DD HH:MM:SS`. */
function utcStand(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function geometrie(g: ExportGeometrie): ExportGeometrie {
  if (g.type !== 'Polygon') return g;
  return { type: 'Polygon', coordinates: g.coordinates.map(schliesseRing) };
}

function properties(o: ExportObjekt): Record<string, unknown> {
  const p: Record<string, unknown> = { name: o.name, 'lfh:art': o.art };
  if (o.zeichen) p['lfh:zeichen'] = o.zeichen.spec;
  if (o.warnstufe !== undefined) p['lfh:warnstufe'] = o.warnstufe;
  if (o.kreis) p['lfh:kreis'] = { mitte: o.kreis.mitte, radius_m: o.kreis.radius_m };

  const s = o.stil;
  if (o.geometrie.type === 'Point') {
    if (s.markerFarbe) p['marker-color'] = s.markerFarbe;
    return p;
  }
  if (s.linie) {
    p.stroke = s.linie;
    p['stroke-opacity'] = 1;
  }
  if (s.breite !== undefined) p['stroke-width'] = s.breite;
  if (s.fuellung) p.fill = s.fuellung;
  if (s.deckkraft !== undefined) p['fill-opacity'] = s.deckkraft;
  return p;
}

export function writeGeojson(
  objekte: ExportObjekt[],
  meta: { stand: Date; einsatzName: string },
): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      'lfh:stand': utcStand(meta.stand),
      'lfh:quelle': 'Lifeline Hub',
      features: objekte.map((o) => ({
        type: 'Feature',
        geometry: geometrie(o.geometrie),
        properties: properties(o),
      })),
    },
    null,
    2,
  );
}
