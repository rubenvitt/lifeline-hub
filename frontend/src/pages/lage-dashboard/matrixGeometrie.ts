/**
 * Klassen der Gefahrenmatrix. Die Spaltengeometrie steht in `gefahrenmatrix.css`, weil sie an der
 * Breite des Paneels hängt (Container-Abfrage) — das kann ein Inline-Stil nicht. Zeilen und Legende
 * nehmen dieselben Klassen; das hält die Legende bündig unter den Segmenten.
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
