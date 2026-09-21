import type { AbBreitePunkt } from '../components/useViewport';

/**
 * Reine Darstellungsregeln des Meldebild-Statusbands (Neuentwurf S6, `statusStufen`).
 * Getrennt von `Statusband.tsx`, damit die Zusicherung ohne Rendern prüfbar ist (jsdom
 * rechnet kein Layout).
 *
 * Die Farbregeln (Zahl je Ton und Modus, Farbe des Quadrats) standen bis 22.09.2026 hier;
 * seit das Band auf den Baustein `Kennzahl` umgestellt ist, liegen sie dort (`zahlFarbe`,
 * `punktFarbe` — samt der Kontrasttabelle im Dateikopf von `components/instrument/Kennzahl.tsx`).
 */

/** Spaltenzahl des Bands: 6 ab `xl`, 3 ab `md`, 2 darunter. */
export function bandSpalten(abBreite: (punkt: AbBreitePunkt) => boolean): number {
  if (abBreite('xl')) return 6;
  if (abBreite('md')) return 3;
  return 2;
}
