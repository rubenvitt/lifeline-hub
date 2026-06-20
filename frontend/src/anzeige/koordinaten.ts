/**
 * WGS84 → UTM / MGRS (LFH-136). Kleine, getestete Eigenimplementierung ohne
 * schwere Dependency (kein proj4), bewusst auf den BOS-Einsatzraum zugeschnitten.
 *
 * UTM-Vorwärtsprojektion: Snyder-/Karney-Reihe (mm-genau im Streifen). MGRS:
 * 100-km-Quadrat-Buchstaben mit der zonenparität-abhängigen Zeilensequenz.
 *
 * Bewusste Grenzen (siehe Plan-Risiken): die UTM-Zonen-Ausnahmen für
 * Norwegen (32V) und Svalbard (31X/33X/35X/37X) sind NICHT abgebildet — für
 * Deutschland/Mitteleuropa irrelevant. Polnahe Bereiche (UPS) ebenfalls nicht.
 * GK-Genauigkeit ca. 3 m (Gauss-Krüger via proj4, Bessel-Ellipsoid).
 */

import proj4 from 'proj4';
import { forward as mgrsForward, toPoint as mgrsToPoint } from 'mgrs';
import type { Koordinatenformat } from '../api/types';
import './proj4Setup';

export interface LatLon { lat: number; lon: number; }

export class KoordinatenParseFehler extends Error {
  constructor(text: string, system: Koordinatenformat) {
    super(`Ungültige ${system}-Koordinate: "${text}"`);
    this.name = 'KoordinatenParseFehler';
  }
}

function pruefeBereich(lat: number, lon: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('NaN');
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('Bereich');
}

function formatiereWgs84(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
function parseWgs84(text: string): LatLon {
  const teile = text.split(',').map((s) => Number(s.trim()));
  if (teile.length !== 2 || teile.some((n) => !Number.isFinite(n))) throw new Error('Format');
  const [lat, lon] = teile;
  pruefeBereich(lat, lon);
  return { lat, lon };
}

function dmsTeil(wert: number, istBreite: boolean): string {
  const hemi = istBreite ? (wert >= 0 ? 'N' : 'S') : (wert >= 0 ? 'E' : 'W');
  const abs = Math.abs(wert);
  let grad = Math.floor(abs);
  const restMin = (abs - grad) * 60;
  let min = Math.floor(restMin);
  let sek = Math.round((restMin - min) * 60);
  if (sek === 60) { sek = 0; min += 1; }
  if (min === 60) { min = 0; grad += 1; }
  const g = String(grad).padStart(istBreite ? 2 : 3, '0');
  return `${g}°${String(min).padStart(2, '0')}'${String(sek).padStart(2, '0')}"${hemi}`;
}
function formatiereDms(lat: number, lon: number): string {
  return `${dmsTeil(lat, true)} ${dmsTeil(lon, false)}`;
}
const DMS_RE = /(\d+(?:\.\d+)?)°\s*(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)"?\s*([NSEWnsew])/g;
function parseDms(text: string): LatLon {
  const treffer = [...text.matchAll(DMS_RE)];
  if (treffer.length !== 2) throw new Error('Format');
  let lat: number | null = null;
  let lon: number | null = null;
  for (const t of treffer) {
    const dez = Number(t[1]) + Number(t[2]) / 60 + Number(t[3]) / 3600;
    const hemi = t[4].toUpperCase();
    if (hemi === 'N' || hemi === 'S') lat = hemi === 'S' ? -dez : dez;
    else lon = hemi === 'W' ? -dez : dez;
  }
  if (lat === null || lon === null) throw new Error('Achse');
  pruefeBereich(lat, lon);
  return { lat, lon };
}

const UTM_BANDS = 'CDEFGHJKLMNPQRSTUVWX';
function utmZoneNr(lon: number): number {
  return Math.floor(((lon + 180) % 360) / 6) + 1;
}
function breitenband(lat: number): string {
  const idx = Math.max(0, Math.min(UTM_BANDS.length - 1, Math.floor((lat + 80) / 8)));
  return UTM_BANDS[idx];
}
function formatiereUtm(lat: number, lon: number): string {
  const zone = utmZoneNr(lon);
  const [e, n] = proj4('EPSG:4326', `EPSG:326${String(zone).padStart(2, '0')}`, [lon, lat]);
  return `${zone}${breitenband(lat)} ${Math.round(e)} ${Math.round(n)}`;
}
const UTM_RE = /^(\d{1,2})\s*([C-Xc-x])\s+(\d+)\s+(\d+)$/;
function parseUtm(text: string): LatLon {
  const m = UTM_RE.exec(text.trim());
  if (!m) throw new Error('Format');
  const zone = Number(m[1]);
  const nord = m[2].toUpperCase() >= 'N';
  const epsg = `EPSG:${nord ? '326' : '327'}${String(zone).padStart(2, '0')}`;
  const [lon, lat] = proj4(epsg, 'EPSG:4326', [Number(m[3]), Number(m[4])]);
  pruefeBereich(lat, lon);
  return { lat, lon };
}

function formatiereMgrs(lat: number, lon: number): string {
  const s = mgrsForward([lon, lat], 5); // kompakt, z.B. "32UNB1234567890"
  const m = /^(\d{1,2}[C-X])([A-Z]{2})(\d{5})(\d{5})$/.exec(s);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : s;
}
function parseMgrs(text: string): LatLon {
  const [lon, lat] = mgrsToPoint(text.replace(/\s+/g, '').toUpperCase());
  pruefeBereich(lat, lon);
  return { lat, lon };
}

function gkZone(lon: number): number {
  return Math.round(lon / 3); // lon_0 = 3·Zone
}
function formatiereGk(lat: number, lon: number): string {
  const zone = gkZone(lon);
  const [r, h] = proj4('EPSG:4326', `EPSG:${31464 + zone}`, [lon, lat]);
  return `R ${Math.round(r)}  H ${Math.round(h)}`;
}
const GK_RE = /R?\s*(\d{7})\s+H?\s*(\d{7})/i;
function parseGk(text: string): LatLon {
  const m = GK_RE.exec(text.trim());
  if (!m) throw new Error('Format');
  const r = Number(m[1]);
  const zone = Math.floor(r / 1_000_000); // führende Ziffer = Zone
  if (zone < 2 || zone > 5) throw new Error('Zone');
  const [lon, lat] = proj4(`EPSG:${31464 + zone}`, 'EPSG:4326', [r, Number(m[2])]);
  pruefeBereich(lat, lon);
  return { lat, lon };
}

export function formatiere(lat: number, lon: number, system: Koordinatenformat): string {
  switch (system) {
    case 'dms': return formatiereDms(lat, lon);
    case 'utm': return formatiereUtm(lat, lon);
    case 'mgrs': return formatiereMgrs(lat, lon);
    case 'gk': return formatiereGk(lat, lon);
    case 'wgs84':
    default:
      return formatiereWgs84(lat, lon);
  }
}

export function parse(text: string, system: Koordinatenformat): LatLon {
  try {
    switch (system) {
      case 'dms': return parseDms(text);
      case 'utm': return parseUtm(text);
      case 'mgrs': return parseMgrs(text);
      case 'gk': return parseGk(text);
      case 'wgs84':
      default:
        return parseWgs84(text);
    }
  } catch {
    throw new KoordinatenParseFehler(text, system);
  }
}

const A = 6_378_137.0; // WGS84 große Halbachse
const F = 1 / 298.257223563; // Abplattung
const K0 = 0.9996; // UTM-Maßstabsfaktor
const E2 = F * (2 - F); // e²
const EP2 = E2 / (1 - E2); // e'²

/** Breitenband-Buchstaben (8°-Bänder von 80°S bis 84°N), ohne I und O. */
const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
/** Spalten-Buchstaben je Zonen-Restklasse (jeweils 8 Buchstaben, ohne I/O). */
const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
/** Zeilen-Buchstaben (20er-Alphabet, ohne I und O). */
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

export interface UtmKoordinate {
  zone: number;
  band: string;
  hemisphere: 'N' | 'S';
  easting: number;
  northing: number;
}

const grad = (g: number) => (g * Math.PI) / 180;

/** UTM-Zonennummer aus der geografischen Länge (Ausnahmen bewusst ignoriert). */
export function utmZone(_lat: number, lon: number): number {
  return Math.floor(((lon + 180) % 360) / 6) + 1;
}

/** Breitenband-Buchstabe für die Breite (für GZD/MGRS). */
function bandBuchstabe(lat: number): string {
  if (lat >= 84) return 'X';
  if (lat < -80) return 'C';
  const idx = Math.floor((lat + 80) / 8);
  return BANDS[Math.min(idx, BANDS.length - 1)];
}

/** WGS84 (Dezimalgrad) → UTM. */
export function wgs84ZuUtm(lat: number, lon: number): UtmKoordinate {
  const zone = utmZone(lat, lon);
  const lonOrigin = (zone - 1) * 6 - 180 + 3; // Mittelmeridian der Zone (Grad)
  const phi = grad(lat);
  const lambda0 = grad(lonOrigin);
  const dLambda = grad(lon) - lambda0;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = EP2 * cosPhi * cosPhi;
  const Acoef = cosPhi * dLambda;

  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    K0 *
      N *
      (Acoef +
        ((1 - T + C) * Acoef ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Acoef ** 5) / 120) +
    500_000;

  let northing =
    K0 *
    (M +
      N *
        tanPhi *
        (Acoef ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Acoef ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Acoef ** 6) / 720));

  const hemisphere: 'N' | 'S' = lat >= 0 ? 'N' : 'S';
  if (lat < 0) northing += 10_000_000; // False-Northing (Südhalbkugel)

  return { zone, band: bandBuchstabe(lat), hemisphere, easting, northing };
}

/**
 * WGS84 (Dezimalgrad) → MGRS-String `ZZB CR EEEEE NNNNN`. `stellen` = Stellen
 * je Achse (5 = 1 m, 4 = 10 m, … 1 = 10 km). Easting/Northing werden gemäß
 * MGRS-Standard abgeschnitten (truncate), nicht gerundet.
 */
export function wgs84ZuMgrs(lat: number, lon: number, stellen = 5): string {
  const { zone, band, easting, northing } = wgs84ZuUtm(lat, lon);

  const colLetter = COL_SETS[(zone - 1) % 3][Math.floor(easting / 100_000) - 1];

  // Zeilensequenz beginnt bei geraden Zonen um 5 Buchstaben versetzt.
  let rowIdx = Math.floor(northing / 100_000) % 20;
  if (zone % 2 === 0) rowIdx = (rowIdx + 5) % 20;
  const rowLetter = ROW_LETTERS[rowIdx];

  const factor = 10 ** (5 - stellen);
  const e = Math.floor(Math.floor(easting % 100_000) / factor);
  const n = Math.floor(Math.floor(northing % 100_000) / factor);
  const eStr = String(e).padStart(stellen, '0');
  const nStr = String(n).padStart(stellen, '0');

  return `${zone}${band} ${colLetter}${rowLetter} ${eStr} ${nStr}`;
}
