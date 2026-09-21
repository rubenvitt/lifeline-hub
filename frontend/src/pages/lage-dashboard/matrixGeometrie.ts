/**
 * Klassen der Gefahrenmatrix (Neuentwurf S3). Die Spaltengeometrie selbst steht in
 * `gefahrenmatrix.css` — sie hängt an der Breite des PANEELS (Container-Abfrage), nicht am
 * Viewport, und das kann ein Inline-Stil nicht. Zeilen und Legende nehmen DIESELBEN Klassen;
 * genau das hält die Legende bündig unter den Segmenten (Nacharbeit 22.09.2026: vorher Flex
 * mit 2 px Lücke gegen ein Raster ohne Lücke, „niedrigmittel hoch akut" gequetscht).
 */
export const MATRIX_KLASSE = {
  /** Wurzel der Matrix — der Container, gegen den gemessen wird. */
  wurzel: 'lfh-gefahrenmatrix',
  /** Name · Balken · Stufenwort; auch die Legendenzeile. */
  zeile: 'lfh-matrixzeile',
  /** Das Vier-Stufen-Raster: Balken UND Legende. */
  stufen: 'lfh-stufenraster',
  /** Zusatz der Legendenzeile. */
  legende: 'lfh-matrixlegende',
  /** Leere Namens-/Stufenwortzelle der Legende — im schmalen Paneel ausgeblendet. */
  fueller: 'lfh-matrixfueller',
} as const;
