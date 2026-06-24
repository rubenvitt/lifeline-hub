import type { Ecke, Ecken } from '../../api/kartenbilder';

export interface Rechteck {
  center: Ecke;        // [lng, lat]
  breiteGrad: number;  // lng-Ausdehnung in Grad bei rotation=0
  hoeheGrad: number;   // lat-Ausdehnung in Grad
  rotationGrad: number;
}

const grad = (r: number) => (r * Math.PI) / 180;

/** Rechteck → 4 Ecken (TL, TR, BR, BL). Rotation winkeltreu in Bildschirm-Metrik
 *  (lng wird mit cos(lat) skaliert, damit Drehung das Bild nicht verzerrt). */
export function eckenAusRechteck(r: Rechteck): Ecken {
  const [clng, clat] = r.center;
  const latCos = Math.cos(grad(clat)) || 1e-9;
  const cos = Math.cos(grad(r.rotationGrad));
  const sin = Math.sin(grad(r.rotationGrad));
  const hw = r.breiteGrad / 2;
  const hh = r.hoeheGrad / 2;
  // lokale Offsets [dLng, dLat] vor Rotation: TL, TR, BR, BL
  const lokal: Ecke[] = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]];
  const ecken = lokal.map(([dx, dy]) => {
    // in isotropen (Bildschirm-)Raum: x metrisch = dLng * latCos
    const mx = dx * latCos;
    const my = dy;
    const rx = mx * cos - my * sin;
    const ry = mx * sin + my * cos;
    return [clng + rx / latCos, clat + ry] as Ecke;
  });
  return ecken as Ecken;
}

/** 4 Ecken → Rechteck. center = Schwerpunkt; breite/hoehe aus Kantenlängen
 *  (TL-TR bzw. TL-BL), Rotation aus dem Winkel der oberen Kante. */
export function rechteckAusEcken(e: Ecken): Rechteck {
  const [tl, tr, , bl] = e;
  const clng = (e[0][0] + e[1][0] + e[2][0] + e[3][0]) / 4;
  const clat = (e[0][1] + e[1][1] + e[2][1] + e[3][1]) / 4;
  const latCos = Math.cos(grad(clat)) || 1e-9;
  // obere Kante TL→TR in Bildschirm-Metrik
  const ox = (tr[0] - tl[0]) * latCos;
  const oy = tr[1] - tl[1];
  const breiteScreen = Math.hypot(ox, oy);
  // linke Kante TL→BL
  const lx = (bl[0] - tl[0]) * latCos;
  const ly = bl[1] - tl[1];
  const hoeheScreen = Math.hypot(lx, ly);
  const rotationGrad = (Math.atan2(oy, ox) * 180) / Math.PI;
  return {
    center: [clng, clat],
    breiteGrad: breiteScreen / latCos,
    hoeheGrad: hoeheScreen,
    rotationGrad,
  };
}

/** Achsenparallele Ecken aus Bounds (für initialen Upload aus dem Viewport). */
export function eckenAusBounds(west: number, sued: number, ost: number, nord: number): Ecken {
  return [[west, nord], [ost, nord], [ost, sued], [west, sued]];
}
