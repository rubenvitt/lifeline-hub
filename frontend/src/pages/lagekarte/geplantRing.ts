/**
 * Gestrichelter Ring um das Zeichen eines geplanten Bereitstellungsraums (LLH-1107). DV 102 zeigt
 * Geplantes gestrichelt; @einsatzzeichen kennt keine gestrichelte Fassung eines Zeichens, und
 * MapLibres Kreis-Layer keine Strichelung. Deshalb ein eigenes Bild, das ein Symbol-Layer unter das
 * Zeichen legt (`markerLayer.ts`, `marker-geplant`); der Bild-Resolver legt es auf Anfrage an
 * (`kartenbildResolver.ts`), auch nach jedem Stilwechsel.
 *
 * Der Strich ist schwarz mit weißen Kanten, wie die Außenkante der Personen-Marker: Weiß und
 * Schwarz nebeneinander halten auf jedem Grund ≥ 3 : 1 (WCAG 1.4.11), auf der hellen Karte am Tag
 * wie im Nachtbetrieb (LFH-1120). Eine Kontur, keine Statusfarbe — das Wort „geplant" in der
 * Plakette ist der zweite Kanal.
 */

/** Bild-Id des Rings; der Resolver erkennt sie wörtlich. */
export const GEPLANT_RING_BILD = 'ring|geplant';

/**
 * Außenradius in CSS-px. Der Strich (4 px mit Kanten) beginnt 18 px vor der Mitte, außerhalb des
 * auf `ZEICHEN_KARTEN_PX` (34) normierten Zeichens.
 */
export const GEPLANT_RING_RADIUS_PX = 22;

/** Doppelte Dichte: der Ring bleibt auch auf hochauflösenden Schirmen glatt genug. */
const DICHTE = 2;
/** Zahl der Striche rundum und ihr Anteil am Abschnitt (der Rest ist Lücke). */
const STRICHE = 12;
const STRICH_ANTEIL = 0.6;

type Rgba = readonly [number, number, number, number];
const SCHWARZ: Rgba = [0, 0, 0, 255];
const WEISS: Rgba = [255, 255, 255, 255];

/** Farbe am Abstand `d` (CSS-px) von der Mitte, ohne Strichelung; `null` außerhalb des Bands. */
function bandFarbe(d: number): Rgba | null {
  const r = GEPLANT_RING_RADIUS_PX;
  if (d >= r || d < r - 4) return null;
  // Außen und innen je 1 px Weiß, dazwischen 2 px Schwarz.
  return d >= r - 1 || d < r - 3 ? WEISS : SCHWARZ;
}

/** Liegt der Winkel (Grad, 0° rechts, im Uhrzeigersinn) auf einem Strich? */
function aufStrich(grad: number): boolean {
  const phase = (((grad % 360) + 360) % 360) / (360 / STRICHE);
  return phase - Math.floor(phase) < STRICH_ANTEIL;
}

/**
 * Das Ringbild als Pixeldaten für `map.addImage` (mit `pixelRatio`). Rein und exportiert: die
 * Karte läuft in jsdom nicht, die Pixel schon.
 */
export function geplantRingBild(): {
  width: number;
  height: number;
  data: Uint8Array;
  pixelRatio: number;
} {
  const kante = 2 * GEPLANT_RING_RADIUS_PX * DICHTE;
  const mitte = kante / 2;
  const data = new Uint8Array(kante * kante * 4);
  for (let y = 0; y < kante; y++) {
    for (let x = 0; x < kante; x++) {
      const dx = (x + 0.5 - mitte) / DICHTE;
      const dy = (y + 0.5 - mitte) / DICHTE;
      const farbe = bandFarbe(Math.hypot(dx, dy));
      if (!farbe || !aufStrich((Math.atan2(dy, dx) * 180) / Math.PI)) continue;
      data.set(farbe, (y * kante + x) * 4);
    }
  }
  return { width: kante, height: kante, data, pixelRatio: DICHTE };
}
