/**
 * KML-Schreiber des Lagekarten-Exports (Zunder A, Entwurf
 * `docs/superpowers/specs/2026-11-24-k9tkgrou-lagekarte-geo-export-design.md`, „Ein Zwischenmodell,
 * zwei Schreiber“). Reine Funktion über das Zwischenmodell aus `geoExport.ts`.
 *
 * - KML 2.2: ein `Style` je Zeichenschlüssel (Icon, Beschriftung), ein `Folder` je Art, Geometrie
 *   `clampToGround`. Farben sind `aabbggrr` ({@link kmlFarbe}).
 * - **Keine `description`** (Anti-Ziel Freitext); `ExtendedData` trägt nur `lfh:art` und
 *   `lfh:zeichen`. Alle Texte sind XML-escaped, unzulässige Steuerzeichen entfallen.
 * - Die Icon-Datei benennt `iconPfad` (`iconDateiname` im KMZ); den Inhalt rastert
 *   `zeichenPng.ts`.
 */
import type { ExportArt, ExportGeometrie, ExportObjekt } from './geoExport';
import { escapeXml as esc } from './xmlText';

export const KML_MEDIENTYP = 'application/vnd.google-earth.kml+xml';

const ART_NAME: Record<ExportArt, string> = {
  freies_zeichen: 'Freie Zeichen',
  zone: 'Zonen',
  gefahrengebiet: 'Gefahrengebiete',
  evakuierungsbezirk: 'Evakuierungsbezirke',
  schaden: 'Schadenstellen',
  uhs: 'Unfallhilfsstellen',
  betreuung: 'Betreuungsstellen',
  abschnitt: 'Abschnitte',
  fahrzeug: 'Fahrzeuge',
  einheit: 'Einheiten',
  einsatzort: 'Einsatzort',
  fuehrungsstelle: 'Führungsstellen',
  bereitstellungsraum: 'Bereitstellungsräume',
  sammelstelle: 'Sammelstellen',
};

/** FNV-1a (32 Bit) als acht Hexstellen. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Dateiname des Zeichens im KMZ: kurzer Hash des Bildschlüssels. */
export function iconDateiname(schluessel: string): string {
  return `files/${fnv1a(schluessel)}.png`;
}

/**
 * Bild eines Punkts ohne taktisches Zeichen im KMZ: ein weißer Kreis, den `IconStyle/color` in der
 * Markerfarbe einfärbt (KML multipliziert). Ohne eigenes Bild zeigte Google Earth die gelbe
 * Standardnadel, und die Farbe ginge verloren; ein Verweis ins Netz bliebe offline leer.
 */
export const PUNKT_ICON = 'files/punkt.png';

/** `#rrggbb` (oder `#rgb`) und Deckkraft 0 … 1 als KML-Farbe `aabbggrr`. */
export function kmlFarbe(hex: string, deckkraft = 1): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const rr = h.slice(0, 2);
  const gg = h.slice(2, 4);
  const bb = h.slice(4, 6);
  const a = Math.floor(Math.min(1, Math.max(0, deckkraft)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${a}${bb}${gg}${rr}`.toLowerCase();
}

const koordinaten = (punkte: number[][]) => punkte.map(([lon, lat]) => `${lon},${lat},0`).join(' ');

function geometrieKml(g: ExportGeometrie): string {
  const boden = '<altitudeMode>clampToGround</altitudeMode>';
  if (g.type === 'Point') {
    return `<Point>${boden}<coordinates>${koordinaten([g.coordinates])}</coordinates></Point>`;
  }
  if (g.type === 'LineString') {
    return `<LineString><tessellate>1</tessellate>${boden}<coordinates>${koordinaten(g.coordinates)}</coordinates></LineString>`;
  }
  const [aussen, ...innen] = g.coordinates;
  const ring = (r: number[][]) =>
    `<LinearRing><coordinates>${koordinaten(r)}</coordinates></LinearRing>`;
  return (
    `<Polygon><tessellate>1</tessellate>${boden}<outerBoundaryIs>${ring(aussen ?? [])}</outerBoundaryIs>` +
    innen.map((r) => `<innerBoundaryIs>${ring(r)}</innerBoundaryIs>`).join('') +
    '</Polygon>'
  );
}

function linienStilKml(o: ExportObjekt): string {
  const s = o.stil;
  if (o.geometrie.type === 'Point') return '';
  const linie = s.linie
    ? `<LineStyle><color>${kmlFarbe(s.linie)}</color><width>${s.breite ?? 2}</width></LineStyle>`
    : '';
  if (o.geometrie.type === 'LineString') return linie ? `<Style>${linie}</Style>` : '';
  const flaeche = s.fuellung
    ? `<PolyStyle><color>${kmlFarbe(s.fuellung, s.deckkraft ?? 1)}</color><fill>1</fill><outline>${s.linie ? 1 : 0}</outline></PolyStyle>`
    : '<PolyStyle><fill>0</fill></PolyStyle>';
  return `<Style>${linie}${flaeche}</Style>`;
}

/** Punkt ohne Zeichen: der eingefärbte Kreis aus {@link PUNKT_ICON}. */
function punktStilKml(o: ExportObjekt): string {
  const farbe = o.stil.markerFarbe ? `<color>${kmlFarbe(o.stil.markerFarbe)}</color>` : '';
  return (
    `<Style><IconStyle>${farbe}<scale>0.6</scale><Icon><href>${PUNKT_ICON}</href></Icon></IconStyle>` +
    '<LabelStyle><scale>0.9</scale></LabelStyle></Style>'
  );
}

/** Braucht das KMZ das Kreisbild? */
export const brauchtPunktIcon = (objekte: readonly ExportObjekt[]) =>
  objekte.some((o) => !o.zeichen && o.geometrie.type === 'Point');

function placemark(o: ExportObjekt, styleId: (schluessel: string) => string): string {
  const stil = o.zeichen
    ? `<styleUrl>#${styleId(o.zeichen.schluessel)}</styleUrl>`
    : o.geometrie.type === 'Point'
      ? punktStilKml(o)
      : linienStilKml(o);
  const daten =
    `<Data name="lfh:art"><value>${esc(o.art)}</value></Data>` +
    (o.zeichen ? `<Data name="lfh:zeichen"><value>${esc(o.zeichen.spec)}</value></Data>` : '');
  return (
    `<Placemark><name>${esc(o.beschriftung)}</name>${stil}` +
    `<ExtendedData>${daten}</ExtendedData>${geometrieKml(o.geometrie)}</Placemark>`
  );
}

export function writeKml(
  objekte: ExportObjekt[],
  meta: { stand: Date; einsatzName: string },
  iconPfad: (schluessel: string) => string,
): string {
  const schluessel = [
    ...new Set(objekte.flatMap((o) => (o.zeichen ? [o.zeichen.schluessel] : []))),
  ];
  const ids = new Map(schluessel.map((s) => [s, `z-${fnv1a(s)}`]));
  const styleId = (s: string) => ids.get(s) ?? '';

  const styles = schluessel
    .map(
      (s) =>
        `<Style id="${styleId(s)}"><IconStyle><scale>1</scale><Icon><href>${esc(iconPfad(s))}</href></Icon></IconStyle>` +
        '<LabelStyle><scale>0.9</scale></LabelStyle></Style>',
    )
    .join('');

  const nachArt = new Map<ExportArt, ExportObjekt[]>();
  for (const o of objekte) nachArt.set(o.art, [...(nachArt.get(o.art) ?? []), o]);
  const folder = [...nachArt]
    .map(
      ([art, liste]) =>
        `<Folder><name>${esc(ART_NAME[art])}</name>${liste.map((o) => placemark(o, styleId)).join('')}</Folder>`,
    )
    .join('');

  const stand = meta.stand.toISOString().slice(0, 19).replace('T', ' ');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
    `<name>${esc(`${meta.einsatzName} – Stand ${stand} UTC`)}</name>${styles}${folder}` +
    '</Document></kml>\n'
  );
}
