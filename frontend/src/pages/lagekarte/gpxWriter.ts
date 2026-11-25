/**
 * GPX-Schreiber des Lagekarten-Exports für Fireboard und GPS-Geräte (LLH-2128). Reine Funktion
 * über das Zwischenmodell aus `geoExport.ts`, neben `geojsonWriter.ts` und `kmlWriter.ts`.
 *
 * Abgestimmter Weg (25.11.2026), GPX 1.1 (`http://www.topografix.com/GPX/1/1`):
 * - **Punkte → `wpt`**, **Linien → `trk`**, nie `rte`: ein Navigationsgerät rechnet eine Route
 *   zwischen den Punkten neu, die gezeichnete Linie ginge verloren.
 * - **Flächen → geschlossene Spur `trk`**, je Ring ein `trkseg`, erster Punkt = letzter. GPX kennt
 *   keine Polygone; ohne Flächen fehlten Abschnitte, Zonen und Gefahrengebiete.
 * - **`name` = Kartenbeschriftung** (wie KML), weil GPX keine Farben kennt und die Warnstufe deshalb
 *   im Text stehen muss (LFH-357, `pages/lagekarte/AGENTS.md`). `type` = `lfh:art`.
 * - **Keine Farben, keine `desc`/`cmt`, keine Erweiterungen** (Anti-Ziel Freitext).
 * - Das Schema verlangt die Reihenfolge `metadata`, `wpt*`, `rte*`, `trk*`.
 * - Medientyp `application/gpx+xml`, Endung `.gpx`.
 */
import { schliesseRing, type ExportObjekt } from './geoExport';
import { escapeXml as esc } from './xmlText';

export const GPX_MEDIENTYP = 'application/gpx+xml';
export const GPX_ENDUNG = 'gpx';

const GPX_NS = 'http://www.topografix.com/GPX/1/1';

const kopf = (o: ExportObjekt) => `<name>${esc(o.beschriftung)}</name><type>${esc(o.art)}</type>`;

const segment = (punkte: number[][]) =>
  `<trkseg>${punkte.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg>`;

function wpt(o: ExportObjekt): string {
  if (o.geometrie.type !== 'Point') return '';
  const [lon, lat] = o.geometrie.coordinates;
  return `<wpt lat="${lat}" lon="${lon}">${kopf(o)}</wpt>`;
}

function trk(o: ExportObjekt): string {
  const g = o.geometrie;
  if (g.type === 'Point') return '';
  const segmente =
    g.type === 'LineString'
      ? [segment(g.coordinates)]
      : g.coordinates.map((ring) => segment(schliesseRing(ring)));
  return `<trk>${kopf(o)}${segmente.join('')}</trk>`;
}

export function writeGpx(
  objekte: ExportObjekt[],
  meta: { stand: Date; einsatzName: string },
): string {
  const iso = meta.stand.toISOString().slice(0, 19);
  const name = `${meta.einsatzName} – Stand ${iso.replace('T', ' ')} UTC`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<gpx xmlns="${GPX_NS}" version="1.1" creator="Lifeline Hub">` +
    `<metadata><name>${esc(name)}</name><time>${iso}Z</time></metadata>` +
    objekte.map(wpt).join('') +
    objekte.map(trk).join('') +
    '</gpx>\n'
  );
}
