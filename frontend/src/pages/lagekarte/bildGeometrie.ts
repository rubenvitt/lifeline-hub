import type { Ecke, Ecken } from '../../api/kartenbilder';

/** Generischer 2D-Punkt — i. d. R. Bildschirm-Pixel aus `map.project`. */
export type Punkt = [number, number];
type Vier = [Punkt, Punkt, Punkt, Punkt];

/** Schwerpunkt der vier Ecken (in derselben Metrik wie die Eingabe — lng/lat ODER Pixel). */
export function zentroid(ecken: Ecken | Vier): Punkt {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ecken) {
    sx += x;
    sy += y;
  }
  return [sx / ecken.length, sy / ecken.length];
}

/** Alle Ecken um (dLng, dLat) verschieben — reine Translation, keine Verzerrung. */
export function verschiebeEcken(ecken: Ecken, dLng: number, dLat: number): Ecken {
  return ecken.map(([lng, lat]) => [lng + dLng, lat + dLat] as Ecke) as Ecken;
}

/** Uniform um die dem Griff gegenüberliegende Ecke (Anker) skalieren.
 *  Gleichmäßige Skalierung erhält Seitenverhältnis UND Drehung exakt — genau das
 *  gewünschte „Seitenverhältnis immer erhalten". Punkte in Bildschirm-Pixeln;
 *  `maus` ist die aktuelle Zeigerposition. Der Faktor ist die Projektion des
 *  Vektors anker→maus auf die Diagonale anker→griff (so folgt der Griff der Maus
 *  entlang der Diagonale, ohne das Rechteck zu scheren). */
export function skaliereUmAnker(ecken: Vier, griffIndex: number, maus: Punkt, minFaktor = 0.05): Vier {
  const anker = ecken[(griffIndex + 2) % 4];
  const griff = ecken[griffIndex];
  const dx = griff[0] - anker[0];
  const dy = griff[1] - anker[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return ecken;
  const mx = maus[0] - anker[0];
  const my = maus[1] - anker[1];
  const s = Math.max((mx * dx + my * dy) / len2, minFaktor);
  return ecken.map(([x, y]) => [anker[0] + s * (x - anker[0]), anker[1] + s * (y - anker[1])] as Punkt) as Vier;
}

/** Alle Ecken um ihren Schwerpunkt um `deltaRad` drehen (Pixel-Raum). */
export function rotiereUmZentroid(ecken: Vier, deltaRad: number): Vier {
  const [cx, cy] = zentroid(ecken);
  const cos = Math.cos(deltaRad);
  const sin = Math.sin(deltaRad);
  return ecken.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as Punkt;
  }) as Vier;
}

/** Achsenparalleles Rechteck (Pixel) um `centerPx`, Breite `breitePx`,
 *  Seitenverhältnis `ar` = Breite/Höhe. Reihenfolge TL, TR, BR, BL — passend zur
 *  image-source-Konvention; Pixel-Y wächst nach unten (TL/TR oben). */
export function eckenInitialPixel(centerPx: Punkt, breitePx: number, ar: number): Vier {
  const hw = breitePx / 2;
  const hh = hw / ar;
  const [cx, cy] = centerPx;
  return [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
  ];
}

/** Achsenparallele Ecken aus Bounds (Fallback, wenn die Karte noch nicht bereit ist). */
export function eckenAusBounds(west: number, sued: number, ost: number, nord: number): Ecken {
  return [[west, nord], [ost, nord], [ost, sued], [west, sued]];
}
