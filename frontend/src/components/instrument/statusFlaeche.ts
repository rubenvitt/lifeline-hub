import type { Statusrolle } from '../../theme/statusFarben';
import type { Farbrollen } from '../../theme/tokens';

/**
 * Status als getönte FLÄCHE mit getöntem Text — „Ampel als Fläche, Zahl bleibt lesbar"
 * (Neuentwurf S1, Entscheidung 2 des Auftraggebers: hebt „nie Textfläche" für
 * ROLLENfarben auf). Die eine Übersetzung Ton → Grund/Text/Kante für `StatusZelle`,
 * `StatusChip` und die Flächen-Darstellung von `StatusTag`.
 *
 * ── DIE KONTRASTRECHNUNG, und sie entscheidet eine Zeile ────────────────────────────
 *
 * Böden: Kriterium 5 der Bedien-Leitlinie, gemessen in `e2e/betroffene-kontrast.spec.ts`
 * und `e2e/kraefte-kontrast.spec.ts` — Tag ≥ 7 : 1, Nacht ≥ 5 : 1. WCAG-Formel,
 * gerechnet 21.09.2026 aus `farbenHell`/`farbenDunkel`:
 *
 * | Ton      | Text / Grund                 | Tag   | Nacht |
 * |----------|------------------------------|-------|-------|
 * | normal   | normalText / normalFlaeche   | 7,87  | 10,44 |
 * | bedien   | bedienText / bedienFlaeche   | 7,11  |  9,65 |
 * | achtung  | achtung / achtungFlaeche     | 6,02 ✗| 11,18 |
 * | alarm    | alarm / alarmFlaeche         | 5,52 ✗|  6,89 |
 * | neutral  | text2 / flaeche3             | 10,30 | 10,89 |
 *
 * Im TAGMODUS tragen `achtung` und `alarm` als Textfarbe den Boden nicht — es fehlen
 * Rollen `achtungText`/`alarmText` in `theme/tokens.ts` (für `normal` und `bedien` gibt es
 * sie). Bis dahin behält die Fläche dort ihren Ton, die BESCHRIFTUNG aber nimmt `text`:
 * text/achtungFlaeche 16,06, text/alarmFlaeche 15,06. Der Ton bleibt als Fläche und als
 * Kante sichtbar, die Lesbarkeit ist gesichert. Nachts gilt der Entwurf ungebrochen.
 *
 * `neutral` hat keine Statusfläche — `flaeche3` + `text2`, NICHT `schwach` (4,72 nachts,
 * unter 5) und nicht `gedaempft` (6,60 am Tag, unter 7).
 *
 * `kante` ist die Rollenfarbe für einen Rahmen, der sich vom Grund abhebt (WCAG 1.4.11,
 * ≥ 3 : 1 — `kraefte-kontrast.spec.ts` prüft ihn am `StatusTag`): Tag normal 5,96 · bedien
 * 5,57 · achtung 6,02 · alarm 5,52 · neutral (schwach/flaeche3) 4,99; Nacht 7,93 · 5,66 ·
 * 11,18 · 6,89 · 4,72.
 */
export type StatusTon = 'normal' | 'achtung' | 'alarm' | 'bedien' | 'neutral';

export interface StatusFlaecheWerte {
  grund: string;
  text: string;
  kante: string;
}

type Benoetigt = Pick<
  Farbrollen,
  | 'normal'
  | 'normalText'
  | 'normalFlaeche'
  | 'achtung'
  | 'achtungFlaeche'
  | 'alarm'
  | 'alarmFlaeche'
  | 'bedien'
  | 'bedienText'
  | 'bedienFlaeche'
  | 'flaeche3'
  | 'text'
  | 'text2'
  | 'schwach'
>;

export function statusFlaeche(
  rollen: Benoetigt,
  ton: StatusTon,
  dunkel: boolean,
): StatusFlaecheWerte {
  switch (ton) {
    case 'normal':
      return { grund: rollen.normalFlaeche, text: rollen.normalText, kante: rollen.normal };
    case 'bedien':
      return { grund: rollen.bedienFlaeche, text: rollen.bedienText, kante: rollen.bedien };
    case 'achtung':
      return {
        grund: rollen.achtungFlaeche,
        text: dunkel ? rollen.achtung : rollen.text,
        kante: rollen.achtung,
      };
    case 'alarm':
      return {
        grund: rollen.alarmFlaeche,
        text: dunkel ? rollen.alarm : rollen.text,
        kante: rollen.alarm,
      };
    case 'neutral':
      return { grund: rollen.flaeche3, text: rollen.text2, kante: rollen.schwach };
  }
}

/**
 * Welche Statusrolle hat eine Fläche? `marke` nicht: sie ist Signatur (Logo, Rail-Marke),
 * kein Zustand, und hat keine Statusfläche. Rein.
 */
export function tonVonRolle(rolle: Statusrolle): StatusTon | null {
  return rolle === 'marke' ? null : rolle;
}
