/**
 * Großbild-Skala (LLH-1747, Spec `grossbild-ansicht`, „Lesbar aus der Entfernung“; design.md D3 in
 * `openspec/changes/ckl1wbvz-grossbild-lage/`).
 *
 * Die Bezugsgrößen sind die des Lagemonitors bei 1920 × 1080 (`geraet/LagemonitorPage.tsx`,
 * `GROSS`): Zahl 96, Zahl klein 72, Titel 32, Text 28. Bis der Lagemonitor auf diese Bausteine
 * umzieht (Folgeaufgabe nach LLH-1746), stehen die Werte dort ein zweites Mal.
 *
 * `grossMass(px)` macht daraus eine CSS-Länge, die mit dem Fenster geht: bei 1920 × 1080 genau
 * `px`, auf einem Beamer mit 1280 × 720 zwei Drittel, auf 4K das Doppelte. Die knappere Achse
 * gewinnt, damit ein flaches oder schmales Fenster nicht über den Rand läuft. Kein Messwert in JS,
 * keine Untergrenze: eine Untergrenze bräche die Regel „ohne Bildlauf“.
 */
export const GROSS_BEZUG = {
  zahl: 96,
  zahlKlein: 72,
  titel: 32,
  text: 28,
  /** Wort statt Zahl in einer Großbild-Zeile (Warnstufe „hoch“). */
  wort: 40,
  /** Abstände der Fläche. */
  rand: 40,
  luft: 32,
  fuge: 16,
  eng: 8,
} as const;

const BEZUG_BREITE = 1920;
const BEZUG_HOEHE = 1080;

/** Auf acht Stellen gerundet: bei 96 px bleibt die Abweichung unter 0,0001 px. */
function rund(wert: number): number {
  return Math.round(wert * 1e8) / 1e8;
}

/**
 * Ein Bezugspixel als CSS-Länge: `min(vw, vh)` mit Bezug 1920 × 1080. Ein Vorfahr kann es über
 * `--lfh-gross-einheit` festsetzen, etwa die Vorschau im Design System, die kein ganzes Fenster hat.
 */
export const GROSS_EINHEIT = `var(--lfh-gross-einheit, min(${rund(100 / BEZUG_BREITE)}vw, ${rund(100 / BEZUG_HOEHE)}vh))`;

export function grossMass(px: number): string {
  return `calc(${GROSS_EINHEIT} * ${px})`;
}
