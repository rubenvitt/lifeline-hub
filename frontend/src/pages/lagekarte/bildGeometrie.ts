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
export function skaliereUmAnker(
  ecken: Vier,
  griffIndex: number,
  maus: Punkt,
  minFaktor = 0.05,
): Vier {
  const anker = ecken[(griffIndex + 2) % 4];
  const griff = ecken[griffIndex];
  const dx = griff[0] - anker[0];
  const dy = griff[1] - anker[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return ecken;
  const mx = maus[0] - anker[0];
  const my = maus[1] - anker[1];
  const s = Math.max((mx * dx + my * dy) / len2, minFaktor);
  return ecken.map(
    ([x, y]) => [anker[0] + s * (x - anker[0]), anker[1] + s * (y - anker[1])] as Punkt,
  ) as Vier;
}

export type Kante = 'oben' | 'rechts' | 'unten' | 'links';

// Pro Kante: die zwei Ecken, die mitwandern (gezogen), und die zwei der gegenüberliegenden
// Kante (anker, bleiben fix). Indizes: 0=TL, 1=TR, 2=BR, 3=BL. gezogen[k] ist die direkt
// gegenüber von anker[k] liegende Ecke derselben Längsseite.
const KANTEN_ECKEN: Record<Kante, { gezogen: [number, number]; anker: [number, number] }> = {
  oben: { gezogen: [0, 1], anker: [3, 2] },
  rechts: { gezogen: [1, 2], anker: [0, 3] },
  unten: { gezogen: [3, 2], anker: [0, 1] },
  links: { gezogen: [0, 3], anker: [1, 2] },
};

/** Eine Kante entlang der Bild-Normalen verschieben (1D-Resize; gegenüberliegende Kante
 *  als Anker). Ändert NUR diese Dimension → Seitenverhältnis darf sich ändern (freies
 *  Strecken wie bei einem Rechteck). Drehung bleibt erhalten. Pixel-Raum; `maus` ist die
 *  Zeigerposition, die neue Ausdehnung ist deren Projektion auf die Normale ab dem Anker. */
export function skaliereKante(ecken: Vier, kante: Kante, maus: Punkt, minPx = 8): Vier {
  const { gezogen, anker } = KANTEN_ECKEN[kante];
  const a0 = ecken[anker[0]];
  const g0 = ecken[gezogen[0]];
  let nx = g0[0] - a0[0];
  let ny = g0[1] - a0[1];
  const len = Math.hypot(nx, ny);
  if (len === 0) return ecken;
  nx /= len;
  ny /= len;
  const dim = Math.max((maus[0] - a0[0]) * nx + (maus[1] - a0[1]) * ny, minPx);
  const next = [...ecken] as Vier;
  for (let k = 0; k < 2; k++) {
    const a = ecken[anker[k]];
    next[gezogen[k]] = [a[0] + nx * dim, a[1] + ny * dim];
  }
  return next;
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
  return [
    [west, nord],
    [ost, nord],
    [ost, sued],
    [west, sued],
  ];
}
