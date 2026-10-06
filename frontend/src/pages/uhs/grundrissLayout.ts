import type { CSSProperties } from 'react';

/**
 * Maße und Stile des UHS-Grundrisses, die jsdom nicht rechnen kann — rein und exportiert, damit
 * Vitest sie prüft (LFH-970). Die Komponente misst, diese Funktionen entscheiden.
 */

/** Breite der Seitenspalten „Wartebereich“ und „Auf Transport gebracht“ in der Drei-Spalten-Form. */
export const SEITENSPALTE_BREITE = 240;
/** Lücke zwischen den drei Spalten. */
export const SPALTEN_LUECKE = 12;
/** Gestrichelter Rand der Fläche, je Seite 1 px. */
const FLAECHE_RAND = 2;
/**
 * Senkrechte Bildlaufleiste der Fläche, wenn sie höher ist als ihr Fenster: klassische Leisten
 * (Windows 17 px, Chromium unter Linux 15 px) ziehen sie von der Innenbreite ab. Ohne Reserve
 * liefe die Fläche knapp über dem Umschaltpunkt seitlich über, und „weitere Plätze →“ stünde
 * neben vollständig sichtbaren Karten. Überlagernde Leisten (Touch, macOS) kosten nichts; dort
 * schaltet die Form 17 px später um.
 */
const LEISTEN_RESERVE = 17;

/**
 * Was die Drei-Spalten-Form neben der Fläche verbraucht: zwei Seitenspalten, zwei Lücken, der Rand
 * der Fläche und die Reserve für ihre senkrechte Bildlaufleiste.
 */
export const DREI_SPALTEN_SOCKEL =
  2 * SEITENSPALTE_BREITE + 2 * SPALTEN_LUECKE + FLAECHE_RAND + LEISTEN_RESERVE;

/**
 * Passt die Drei-Spalten-Form in den Rahmen, ohne dass die Fläche seitlich scrollt? Entschieden
 * wird nach der gemessenen Breite des Grundriss-Rahmens, nicht nach der Fensterbreite: Rail und
 * Modulpanel ziehen ihr bis zu 270 px ab, und ab `lg` (992 px Fenster) stand die Fläche auf dem
 * Tablet quer zur Hälfte im inneren Bildlauf (LFH-970, U71). Unbekannt (0) heißt Reiterform.
 */
export function dreiSpaltenPassen(rahmenBreite: number, flaecheBreite: number): boolean {
  return rahmenBreite >= DREI_SPALTEN_SOCKEL + flaecheBreite;
}

/** Bildlauf-Maße eines Containers, wie `Element` sie liefert. */
export interface BildlaufMasse {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/**
 * In welche Richtung die Fläche seitlich weitergeht. Unter einem Pixel Rest gilt als Ende:
 * gebrochene Breiten bei Zoom ließen den Hinweis sonst am Rand stehen.
 */
export function seitlicherUeberlauf({ scrollLeft, clientWidth, scrollWidth }: BildlaufMasse): {
  links: boolean;
  rechts: boolean;
} {
  return {
    links: scrollLeft >= 1,
    rechts: scrollWidth - clientWidth - scrollLeft >= 1,
  };
}

/**
 * Hülle der Personenmarke in Eingang, Wartebereich und „Noch nicht aufgenommen“ (LFH-970, U72).
 * Die Marke selbst bleibt dichteunabhängig (die belegte Platzkarte plant sie mit 24 px ein); das
 * Bedienziel ist die Hülle, die Klick (Detail) und Zug trägt. Sie misst mindestens die Steuerhöhe
 * der Stufe (`frontend/AGENTS.md`, „Handgebautes Bedienziel“) und füllt die Zeile neben dem
 * Verbleib-Knopf, damit ein Fehlgriff neben der Marke nicht ins Leere geht.
 *
 * Abweichung vom Polster der Regel (`paddingSM`/`padding`): die Hülle umschließt eine gerahmte
 * Marke mit eigenem Innenabstand, keine Textzeile. Waagerechtes Polster nähme dem Namen in der
 * 240-px-Seitenspalte Breite, senkrechtes `paddingSM` machte jede Zeile 24 px höher als die Stufe
 * verlangt. `paddingXXS` hält nur die Marke vom Rand der Hülle frei.
 */
export function markenZielStil(token: {
  controlHeight: number;
  paddingXXS: number;
}): CSSProperties & { minHeight: number; paddingBlock: number } {
  return {
    display: 'flex',
    alignItems: 'center',
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: token.controlHeight,
    paddingBlock: token.paddingXXS,
  };
}
