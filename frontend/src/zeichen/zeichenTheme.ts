import { renderTheme, type RenderTheme } from '@einsatzzeichen/core';

/**
 * Render-Theme für Zeichen auf dunklem Grund (LLH-1141): das Theme `dark` der Bibliothek
 * (ESZ-119). Zeichen ohne Organisation zeichnet die Bibliothek mit schwarzem Umriss ohne Fläche,
 * auf dem Grund des Nachtbetriebs hielt er rund 1,1 : 1. Das Theme macht das Zeichen selbst hell,
 * ohne Fläche dahinter: eine weiße Hinterlegung folgt eng der Kontur jedes malenden Blatts,
 * Kopfmarken und Fahrwerk stehen weiß auf dem Grund, Körperfüllungen und ihre schwarze Schrift
 * bleiben wie am Tag. Keine Farbumkehr (die verwirft die Bibliothek bewusst), die Farben nach
 * DV 102 bleiben; Palette und Kontursignaturen sind die von `accessible-light`.
 * Kontur gegen Hinterlegung und Hinterlegung gegen dunklen Grund ≥ 3 : 1: `zeichenTheme.test.ts`,
 * im Browser `e2e/lagekarte-zeichen-kontrast.spec.ts` (Karte), `e2e/zeichen-kontrast.spec.ts`
 * (Meldebild, Organigramm) und „Zeichenkontrast“ in `e2e/fernmeldeskizze-ausstattung.spec.ts`.
 */
export const ZEICHEN_THEME_DUNKEL: RenderTheme = renderTheme('dark');

/**
 * Das Render-Theme eines Zeichens nach dem Grund, auf dem es steht: dunkel → {@link
 * ZEICHEN_THEME_DUNKEL}, sonst keins (Referenzpalette der Bibliothek, wie bisher). Nur für den
 * Schirm; der Druck steht immer auf Papier und nimmt `false`. In React: `useZeichenTheme`.
 */
export function zeichenTheme(dunkel: boolean): RenderTheme | undefined {
  return dunkel ? ZEICHEN_THEME_DUNKEL : undefined;
}
