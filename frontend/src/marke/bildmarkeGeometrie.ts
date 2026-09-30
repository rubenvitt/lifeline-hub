/**
 * Bildmarke „Lebenslinie“ (LFH-837): eine Pulslinie, die in einem Quadrat in `marke` endet.
 *
 * EINE Geometrie für die ganze App. `Bildmarke.tsx` zeichnet daraus die Marke der Oberfläche,
 * die Quell-SVGs in `scripts/marke/` binden denselben Pfad über `<g transform>` ein, und
 * `scripts/marke/erzeuge-symbole.sh` erzeugt daraus Favicon, PWA- und Desktop-Symbole.
 * `marke.guard.test.ts` hält die Quellen wörtlich auf diesen Werten. Wer die Form ändert,
 * ändert sie hier, zieht die Quellen nach und lässt das Skript laufen.
 *
 * Das lokale Raster hat die Grundlinie bei y = 0. Die Zacke ist punktsymmetrisch, damit die
 * Gehrungen oben und unten gleich weit überstehen. Die Ecken sind Gehrungen (Radius 0 der
 * Gestaltungssprache). Sie ragen über die Pfadpunkte hinaus, deshalb ist der `viewBox` im
 * Browser mit Strich gemessen, nicht aus den Punkten gerechnet (Design D1).
 */

/** Pulslinie: Grundlinie, Zacke hoch, Zacke tief, zurück, bis an das Quadrat. */
export const LINIE_PFAD = 'M0 0H86L136-110L198 110L248 0H324';
export const LINIE_STAERKE = 54;
/** Harte Ecken (Radius 0); die Grenze liegt über dem Gehrungsverhältnis der Zacke (≈ 2,9). */
export const LINIE_ECKE = 'miter';
export const LINIE_GEHRUNGSGRENZE = 10;

/** Das Quadrat in `marke`; die Linie endet stumpf an seiner linken Kante. */
export const QUADRAT = { x: 324, y: -36, kante: 72 } as const;

/** Enges Rechteck um die gezeichnete Marke samt Gehrungen (gemessen, s. o.; der Guard rechnet nach). */
export const MARKE_RAHMEN = { x: 0, y: -189, breite: 396, hoehe: 378 } as const;
export const MARKE_VIEWBOX = `${MARKE_RAHMEN.x} ${MARKE_RAHMEN.y} ${MARKE_RAHMEN.breite} ${MARKE_RAHMEN.hoehe}`;
