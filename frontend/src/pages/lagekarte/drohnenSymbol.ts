/**
 * Das Fluggerät-Symbol der Drohnenlage (LLH-2106) als Pixeldaten für `map.addImage`: ein Pfeil, der
 * nach oben zeigt und über `icon-rotate` mit `heading_deg` gedreht wird. Weiß mit schwarzer Kante:
 * die Doppelkante der Ebenenpunkte (`fachebenenLayer.ts`, LFH-600) hält Kontrast gegen jeden
 * Kartengrund und gegen die Ebenenfarbe des Kreises darunter. Rein und exportiert: die Karte läuft
 * in jsdom nicht, die Pixel schon.
 */

/** Bild-ID des Symbols in der Karte. */
export const DROHNEN_PFEIL_ID = 'drohne-pfeil';

/** Kantenlänge in CSS-px; das Bild trägt `DICHTE`-fache Auflösung. */
export const DROHNEN_PFEIL_KANTE_PX = 16;
const DICHTE = 2;
/** Breite der schwarzen Kante in CSS-px. */
const KANTE_PX = 1.25;

/** Eckpunkte des Pfeils in Einheiten der Kantenlänge (0–1), Spitze oben. */
const ECKEN: readonly (readonly [number, number])[] = [
  [0.5, 0.06],
  [0.9, 0.92],
  [0.5, 0.7],
  [0.1, 0.92],
];

/** Liegt der Punkt im Polygon (gerade-ungerade-Regel)? */
function liegtDrin(x: number, y: number): boolean {
  let drin = false;
  for (let i = 0, j = ECKEN.length - 1; i < ECKEN.length; j = i++) {
    const [xi, yi] = ECKEN[i];
    const [xj, yj] = ECKEN[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

/** Kürzester Abstand des Punkts zu einer Kante des Polygons, in Einheiten der Kantenlänge. */
function abstandZurKante(x: number, y: number): number {
  let kleinster = Infinity;
  for (let i = 0; i < ECKEN.length; i++) {
    const [ax, ay] = ECKEN[i];
    const [bx, by] = ECKEN[(i + 1) % ECKEN.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    kleinster = Math.min(kleinster, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return kleinster;
}

export function drohnenPfeilBild(): {
  width: number;
  height: number;
  data: Uint8Array;
  pixelRatio: number;
} {
  const kante = DROHNEN_PFEIL_KANTE_PX * DICHTE;
  const data = new Uint8Array(kante * kante * 4);
  const kantenBreite = KANTE_PX / DROHNEN_PFEIL_KANTE_PX;
  for (let y = 0; y < kante; y++) {
    for (let x = 0; x < kante; x++) {
      const px = (x + 0.5) / kante;
      const py = (y + 0.5) / kante;
      const drin = liegtDrin(px, py);
      const abstand = abstandZurKante(px, py);
      // Innen weiß bis zur Kante, auf der Kante und knapp außerhalb schwarz.
      const farbe =
        drin && abstand > kantenBreite
          ? [255, 255, 255, 255]
          : abstand <= kantenBreite
            ? [0, 0, 0, 255]
            : null;
      if (farbe) data.set(farbe, (y * kante + x) * 4);
    }
  }
  return { width: kante, height: kante, data, pixelRatio: DICHTE };
}
