import type { StatusTon } from '../components/instrument';
import type { AbBreitePunkt } from '../components/useViewport';
import type { Farbrollen } from '../theme/tokens';

/**
 * Reine Darstellungsregeln des Meldebild-Statusbands (Neuentwurf S6, `statusStufen`):
 * Zellen auf der NEUTRALEN Fläche, Ton nur im 8-px-Quadrat und in der Zahl. Getrennt von
 * `Statusband.tsx`, damit die Zusicherungen ohne Rendern prüfbar sind (jsdom rechnet weder
 * Layout noch Kontrast).
 *
 * ── WARUM DIE ZAHL TAGS NICHT IMMER IM TON STEHT ────────────────────────────────────
 *
 * Boden des Meldebilds (`e2e/kraefte-kontrast.spec.ts`): Tag ≥ 7 : 1, Nacht ≥ 5 : 1.
 * Gerechnet 22.09.2026 (WCAG-Formel) gegen `flaeche`:
 *
 * | Ton     | Rolle der Zahl | Tag (auf #ffffff) | Nacht (auf #0f1215) |
 * |---------|----------------|-------------------|---------------------|
 * | normal  | normalText     | 9,18              | 10,92               |
 * | bedien  | bedienText     | 8,41              |  9,95               |
 * | achtung | achtung        | 6,92 ✗            | 11,75               |
 * | alarm   | alarm          | 6,78 ✗            |  6,77               |
 * | neutral | text2          | 13,13             | 11,60               |
 *
 * `achtung`/`alarm` tragen den Tagesboden als Textfarbe nicht — dieselbe Lücke, die
 * `statusFlaeche.ts` beschreibt. Tags steht deren Zahl deshalb in `text` (18,47); der Ton
 * bleibt im Quadrat sichtbar, und Code plus Wort sind der zweite Kanal. Nachts gilt der
 * Entwurf ungebrochen. Beschriftung (Code, Wort) in `gedaempft`: Tag 8,42, Nacht 7,27.
 */

/** Spaltenzahl des Bands: 6 ab `xl`, 3 ab `md`, 2 darunter. */
export function bandSpalten(abBreite: (punkt: AbBreitePunkt) => boolean): number {
  if (abBreite('xl')) return 6;
  if (abBreite('md')) return 3;
  return 2;
}

type ZahlRollen = Pick<
  Farbrollen,
  'normalText' | 'bedienText' | 'achtung' | 'alarm' | 'text' | 'text2'
>;

/** Farbe der Zahl je Ton und Modus — siehe Tabelle oben. */
export function bandZahlFarbe(rollen: ZahlRollen, ton: StatusTon, dunkel: boolean): string {
  switch (ton) {
    case 'normal':
      return rollen.normalText;
    case 'bedien':
      return rollen.bedienText;
    case 'achtung':
      return dunkel ? rollen.achtung : rollen.text;
    case 'alarm':
      return dunkel ? rollen.alarm : rollen.text;
    case 'neutral':
      return rollen.text2;
  }
}

/** Farbe des 8-px-Quadrats: die Rollenfarbe selbst, `neutral` in `schwach`. */
export function bandQuadratFarbe(
  rollen: Pick<Farbrollen, 'normal' | 'bedien' | 'achtung' | 'alarm' | 'schwach'>,
  ton: StatusTon,
): string {
  return ton === 'neutral' ? rollen.schwach : rollen[ton];
}
