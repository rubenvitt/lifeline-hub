/**
 * Objekte der Lagekarte für den Geodaten-Export (Zunder A, Entwurf
 * `docs/superpowers/specs/2026-11-24-k9tkgrou-lagekarte-geo-export-design.md`, „Was hineinkommt“).
 *
 * Ein Zwischenmodell für beide Schreiber (`geojsonWriter.ts`, `kmlWriter.ts`). Die Eingabe ist
 * schon die Menge, die die Karte zeichnet (`sichtbareMarker`, `kartenFlaechen`, `zonenFeatures`):
 * Sichtbarkeit, Modulfreigabe, Fokus und Ansicht filtert der Aufrufer, hier wird nur gewählt,
 * welche ARTEN hinein dürfen.
 *
 * - **Abschließende Liste:** {@link EXPORT_MARKER_ARTEN}. `fuehrung` (Personenname), `tier`
 *   (Halterbezug), `lagemeldung` (Meldungsinhalt) und `person` bleiben draußen; ein neuer
 *   Markertyp fällt im Test auf, bis er hier oder dort steht.
 * - **Keine Freitexte:** ein Marker trägt nur `label` (Einsatzort: das Wort „Einsatzort“, nicht
 *   die Anschrift), nie `beschriftungZusatz`, Notiz oder Beschreibung.
 * - **Warnstufe trägt der Text** (LFH-357, `pages/lagekarte/AGENTS.md`): `warnstufe` als Code,
 *   die Beschriftung mit „Warnstufe: <label>“ allein aus `warnstufeKarte`.
 * - **Farben als Hex, immer in Tagestönen** (LLH-2133): Gefahrengebiete in
 *   {@link GEFAHR_EXPORT_FARBE}, Marker mit Rollenfarbe über {@link tagesFarbe}; nie ein
 *   Theme-Token oder eine CSS-Variable. Nachts und am Tag gezogene Dateien sehen gleich aus.
 */
import { parseAnySpec } from '@einsatzzeichen/core/exact';
import type { Drawing } from '@einsatzzeichen/schema';
import { theme, type GlobalToken } from 'antd';
import { rollenFarbe, warnstufeKarte, type Statusrolle } from '../../theme/statusFarben';
import { antdAlgorithmus, antdToken, farbenHell } from '../../theme/tokens';
import { fuellfarbe } from '../../zeichen/freiesZeichen';
import { formatRadius, type GeoJsonLineString, type GeoJsonPolygon } from './geo';
import { ABSCHNITT_FARBE, type ZoneFeature } from './kartenLayer';
import type { KarteMarker, MarkerTyp } from './marker';
import { markerZeichen } from './markerIcons';
import { zoneTypLabel } from './zonenStil';

export type ExportArt =
  | 'freies_zeichen'
  | 'zone'
  | 'gefahrengebiet'
  | 'evakuierungsbezirk'
  | 'schaden'
  | 'uhs'
  | 'betreuung'
  | 'abschnitt'
  | 'fahrzeug'
  | 'einheit'
  | 'einsatzort'
  | 'fuehrungsstelle'
  | 'bereitstellungsraum'
  | 'sammelstelle';

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number];
}

/** Geometrie eines Exportobjekts, Koordinaten `[lon, lat]` mit sechs Nachkommastellen. */
export type ExportGeometrie = GeoJsonPoint | GeoJsonPolygon | GeoJsonLineString;

export interface ExportStil {
  /** Linienfarbe `#rrggbb`. */
  linie?: string;
  /** Füllfarbe `#rrggbb`. */
  fuellung?: string;
  /** Deckkraft der Füllung, 0 … 1. */
  deckkraft?: number;
  /** Linienbreite in px. */
  breite?: number;
  /** Farbe eines Punkts `#rrggbb`. */
  markerFarbe?: string;
}

export interface ExportObjekt {
  art: ExportArt;
  /** Name ohne Zusätze (GeoJSON `name`). */
  name: string;
  /** Kartenbeschriftung, bei Gefahrengebieten mit „· Warnstufe …“ (KML `name`). */
  beschriftung: string;
  /** Nur Gefahrengebiete: Stufencode aus `Warnstufe` oder `'unbekannt'` (`lfh:warnstufe`). */
  warnstufe?: string;
  geometrie: ExportGeometrie;
  /** Kreiszone: Mitte `[lon, lat]` und Radius (`lfh:kreis`). */
  kreis?: { mitte: [number, number]; radius_m: number };
  /** Taktisches Zeichen: Bildschlüssel `ez|<spec>`, die kanonische Spec und die Zeichnung. */
  zeichen?: { schluessel: string; spec: string; drawing: Drawing };
  stil: ExportStil;
}

export interface ExportEingabe {
  marker: KarteMarker[];
  flaechen: readonly { id: number; label: string; polygon: GeoJsonPolygon }[];
  zonen: ZoneFeature[];
  /**
   * Der Token, mit dem die Karte die Marker gebaut hat (`rollenFarbe(rolle, token)`); an ihm
   * erkennt der Export eine Rollenfarbe des aktiven Modus und tauscht sie gegen den Tageston.
   */
  token: GlobalToken;
  einsatzName: string;
  /**
   * Stand der Datei: in der Historienansicht der gezeigte gesicherte Stand, `null` in der
   * Live-Ansicht (dann der Moment des Klicks, `useGeoExport`).
   */
  stand: Date | null;
}

/** Die abschließende Liste der Markertypen im Export (Spec-Tabelle, „Meine Wahl“). */
export const EXPORT_MARKER_ARTEN: Partial<Record<MarkerTyp, ExportArt>> = {
  freies_zeichen: 'freies_zeichen',
  schaden: 'schaden',
  uhs: 'uhs',
  betreuungsstelle: 'betreuung',
  abschnitt: 'abschnitt',
  fahrzeug: 'fahrzeug',
  einheit: 'einheit',
  einsatzort: 'einsatzort',
  fuehrungsstelle: 'fuehrungsstelle',
  bereitstellungsraum: 'bereitstellungsraum',
  sammelstelle: 'sammelstelle',
};

/**
 * Feste Exportfarben der Gefahrengebiete je Warnrolle: dieselben Töne wie die Karte am Tag
 * (`gefahrengebietStil` in `zonenStil.ts` über `rollenFarbe`), aber unabhängig vom Modus, damit
 * eine nachts gezogene Datei nicht anders aussieht.
 */
export const GEFAHR_EXPORT_FARBE = {
  alarm: farbenHell.alarm,
  achtung: farbenHell.achtung,
} as const;

/** Füllung der Gefahrengebiete, wie `gefahrengebietStil`. */
const GEFAHR_DECKKRAFT = 0.25;
/** Füllung der Abschnittsflächen, wie `sorgeFuerAbschnittLayer` in `kartenLayer.ts`. */
const ABSCHNITT_DECKKRAFT = 0.15;

const ZEICHEN_PRAEFIX = 'ez|';

export function collectExportObjekte(eingabe: ExportEingabe): ExportObjekt[] {
  return [
    ...eingabe.flaechen.map(flaecheObjekt),
    ...eingabe.zonen.map(zoneObjekt),
    ...eingabe.marker.flatMap((mk) => {
      const o = markerObjekt(mk, eingabe.token);
      return o ? [o] : [];
    }),
  ];
}

function flaecheObjekt(f: ExportEingabe['flaechen'][number]): ExportObjekt {
  const name = f.label.trim() || 'Abschnitt';
  return {
    art: 'abschnitt',
    name,
    beschriftung: name,
    geometrie: rundeFlaeche(f.polygon),
    stil: {
      linie: ABSCHNITT_FARBE,
      fuellung: ABSCHNITT_FARBE,
      deckkraft: ABSCHNITT_DECKKRAFT,
      breite: 2,
    },
  };
}

function zoneObjekt(z: ZoneFeature): ExportObjekt {
  const kreis = z.kreis
    ? { mitte: rundePunkt(z.kreis.mitte.lon, z.kreis.mitte.lat), radius_m: z.kreis.radiusM }
    : undefined;
  const geometrie = rundeFlaeche(z.geometrie);
  const roh = z.rohLabel?.trim() ?? '';

  if (z.typ === 'gefahrengebiet') {
    const stufe = z.warnstufe ?? 'unbekannt';
    const name = roh || 'Gefahrengebiet';
    const farbe = gefahrFarbe(stufe);
    const teile = [name, warnstufeText(stufe)];
    if (z.kreis) teile.push(`r = ${formatRadius(z.kreis.radiusM)}`);
    return {
      art: 'gefahrengebiet',
      name,
      beschriftung: teile.join(' · '),
      warnstufe: stufe,
      geometrie,
      ...(kreis ? { kreis } : {}),
      stil: {
        linie: farbe,
        fuellung: farbe,
        deckkraft: GEFAHR_DECKKRAFT,
        breite: z.stil.lineWidth,
      },
    };
  }

  const name = roh || (z.typ ? zoneTypLabel(z.typ) : 'Zone');
  return {
    art: z.typ === 'evakuierungsbezirk' ? 'evakuierungsbezirk' : 'zone',
    name,
    beschriftung: z.label?.trim() || name,
    geometrie,
    ...(kreis ? { kreis } : {}),
    stil: {
      linie: hex(z.stil.lineColor),
      fuellung: hex(z.stil.fillColor),
      deckkraft: z.stil.fillOpacity,
      breite: z.stil.lineWidth,
    },
  };
}

/**
 * Exportfarbe einer Stufe: Rolle aus `warnstufeKarte`; ohne Nachschlag wie `keine` (Alarm), so wie
 * die Karte vorsichtshalber rundet.
 */
function gefahrFarbe(stufe: NonNullable<ZoneFeature['warnstufe']>): string {
  const rolle = warnstufeKarte[stufe === 'unbekannt' ? 'keine' : stufe].rolle;
  return rolle === 'achtung' ? GEFAHR_EXPORT_FARBE.achtung : GEFAHR_EXPORT_FARBE.alarm;
}

/** „Warnstufe: hoch“; der Wortlaut der Stufe nur aus `warnstufeKarte` (LFH-357). */
function warnstufeText(stufe: NonNullable<ZoneFeature['warnstufe']>): string {
  return stufe === 'unbekannt'
    ? 'Warnstufe unbekannt'
    : `Warnstufe: ${warnstufeKarte[stufe].label}`;
}

function markerObjekt(mk: KarteMarker, token: GlobalToken): ExportObjekt | null {
  const art = EXPORT_MARKER_ARTEN[mk.typ];
  if (!art) return null;
  const name = art === 'einsatzort' ? 'Einsatzort' : mk.label.trim() || zeichenloserName(art);
  const zeichen = zeichenVon(mk);
  const markerFarbe = (zeichen && zeichenFarbe(zeichen.spec)) ?? tagesFarbe(hex(mk.farbe), token);
  return {
    art,
    name,
    beschriftung: name,
    geometrie: { type: 'Point', coordinates: rundePunkt(mk.lon, mk.lat) },
    ...(zeichen ? { zeichen } : {}),
    stil: markerFarbe ? { markerFarbe } : {},
  };
}

function zeichenloserName(art: ExportArt): string {
  return art === 'freies_zeichen' ? 'Zeichen' : art;
}

/** `markerZeichen` liefert nur `{schluessel, drawing}`; die Spec steht hinter `ez|`. */
function zeichenVon(mk: KarteMarker): ExportObjekt['zeichen'] {
  const z = markerZeichen(mk);
  if (!z || !z.schluessel.startsWith(ZEICHEN_PRAEFIX)) return undefined;
  return {
    schluessel: z.schluessel,
    spec: z.schluessel.slice(ZEICHEN_PRAEFIX.length),
    drawing: z.drawing,
  };
}

const STATUSROLLEN: readonly Statusrolle[] = [
  'alarm',
  'achtung',
  'normal',
  'bedien',
  'neutral',
  'marke',
];

let tagToken: GlobalToken | undefined;

/** Der helle antd-Token, wie ihn die App am Tag rechnet (vgl. `SkizzenAufnahme`). */
function tagesToken(): GlobalToken {
  tagToken ??= theme.getDesignToken({
    token: antdToken(farbenHell),
    algorithm: antdAlgorithmus(false),
  });
  return tagToken;
}

/**
 * Tageston einer Markerfarbe (LLH-2133): ist sie genau `rollenFarbe(rolle, token)` des Modus, in
 * dem die Karte die Marker gebaut hat, kommt der Wert derselben Rolle am Tag; jede andere Farbe
 * (feste Hexwerte, Zeichenpalette) bleibt, wie sie ist.
 */
export function tagesFarbe(farbe: string | undefined, token: GlobalToken): string | undefined {
  if (!farbe) return farbe;
  const rolle = STATUSROLLEN.find((r) => hex(rollenFarbe(r, token)) === farbe);
  return rolle ? (hex(rollenFarbe(rolle, tagesToken())) ?? farbe) : farbe;
}

/** Füllfarbe des Zeichens aus der `PALETTE` (über `fuellfarbe`), sonst `undefined`. */
function zeichenFarbe(spec: string): string | undefined {
  try {
    return hex(fuellfarbe(parseAnySpec(spec)) ?? undefined);
  } catch {
    return undefined;
  }
}

/** `#rgb` oder `#rrggbb` → `#rrggbb` in Kleinbuchstaben; alles andere (Token, `var()`) → `undefined`. */
function hex(farbe: string | null | undefined): string | undefined {
  const m = farbe?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

function runde(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function rundePunkt(lon: number, lat: number): [number, number] {
  return [runde(lon), runde(lat)];
}

/**
 * Ein Ring ist geschlossen, wenn erster und letzter Punkt gleich sind (RFC 7946, 3.1.6; KML 2.2
 * verlangt dasselbe für `LinearRing`). Geschlossen wird schon im Zwischenmodell, damit GeoJSON und
 * KML dieselbe Geometrie bekommen.
 */
export function schliesseRing(ring: number[][]): number[][] {
  if (ring.length === 0) return ring;
  const a = ring[0];
  const z = ring[ring.length - 1];
  return a[0] === z[0] && a[1] === z[1] ? ring : [...ring, [...a]];
}

/** Stand eines gesicherten Stands (SQLite-Zeit `YYYY-MM-DD HH:MM:SS` oder ISO) als UTC-Datum. */
export function standAusWire(wire: string): Date | null {
  const iso = wire.includes('T') ? wire : `${wire.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function rundeFlaeche<G extends GeoJsonPolygon | GeoJsonLineString>(g: G): G;
function rundeFlaeche(g: GeoJsonPolygon | GeoJsonLineString): GeoJsonPolygon | GeoJsonLineString {
  if (g.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: g.coordinates.map((ring) =>
        schliesseRing(ring.map(([lon, lat]) => rundePunkt(lon, lat))),
      ),
    };
  }
  return {
    type: 'LineString',
    coordinates: g.coordinates.map(([lon, lat]) => rundePunkt(lon, lat)),
  };
}
