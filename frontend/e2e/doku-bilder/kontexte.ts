/**
 * Feste Viewports der Bildschirmfotos (Design LFH-1127, D2). Ein Bild zeigt die App in dem
 * Kontext, in dem sie dort bedient wird; Vorgabe ist der Fükw. Handschuh- und Handybilder nur, wo
 * das Kapitel den Kontext ausdrücklich behandelt (F1).
 *
 * Eigene Datei ohne Playwright-Import, damit `playwright.doku.config.ts` sie laden kann.
 */
export const KONTEXTE = {
  /** Führungskraftwagen, Laptop am Tisch. Vorgabe des Laufs. */
  fuekw: { width: 1440, height: 900 },
  /** Tablet an einer Stelle (UHS, Betreuung, Bereitstellungsraum). */
  tablet: { width: 1280, height: 800 },
  /** Handy. */
  handy: { width: 390, height: 844 },
  /** Lagemonitor an der Wand. */
  lagemonitor: { width: 1920, height: 1080 },
} as const;

export type Kontext = keyof typeof KONTEXTE;
