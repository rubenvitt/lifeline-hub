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
 */

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
