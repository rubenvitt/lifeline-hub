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

export interface LatLon {
  lat: number;
  lon: number;
}

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
  const hemi = istBreite ? (wert >= 0 ? 'N' : 'S') : wert >= 0 ? 'E' : 'W';
  const abs = Math.abs(wert);
  let grad = Math.floor(abs);
  const restMin = (abs - grad) * 60;
  let min = Math.floor(restMin);
  let sek = Math.round((restMin - min) * 60);
  if (sek === 60) {
    sek = 0;
    min += 1;
  }
  if (min === 60) {
    min = 0;
    grad += 1;
  }
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
  try {
    switch (system) {
      case 'dms':
        return formatiereDms(lat, lon);
      case 'utm':
        return formatiereUtm(lat, lon);
      case 'mgrs':
        return formatiereMgrs(lat, lon);
      case 'gk':
        return formatiereGk(lat, lon);
      case 'wgs84':
      default:
        return formatiereWgs84(lat, lon);
    }
  } catch {
    // formatiere läuft ungeschützt im Render-Pfad; projizierte Systeme (GK außerhalb
    // der DE-Zonen 2–5, MGRS außerhalb 80S–84N) können werfen → WGS84-Dezimal-Fallback
    // statt App-Crash.
    return formatiereWgs84(lat, lon);
  }
}

export function parse(text: string, system: Koordinatenformat): LatLon {
  try {
    switch (system) {
      case 'dms':
        return parseDms(text);
      case 'utm':
        return parseUtm(text);
      case 'mgrs':
        return parseMgrs(text);
      case 'gk':
        return parseGk(text);
      case 'wgs84':
      default:
        return parseWgs84(text);
    }
  } catch {
    throw new KoordinatenParseFehler(text, system);
  }
}
