import { form } from '../theme/tokens';

/** Nur die Tokens, die die Zeile braucht — so ist die Funktion ohne Render prüfbar. */
export interface ZeilenToken {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
  marginSM: number;
}

/**
 * Trefflächenboden und Grundform einer Palettenzeile.
 *
 * Handgebautes Bedienziel: ZWEI Angaben, `minHeight` aus `controlHeight` (30 / 48 / 72) plus
 * Polsterung aus den Abstandsrollen; die Palette ist der Berührungsweg zu 42+ Befehlen. Aufgelöste
 * Tokens, nie `var(--lfh-*)` (TSX liest `theme.useToken()`).
 *
 * EIGENES MODUL: die Palette rendert zwei Zweige (flach und gruppiert), und ein verlorener Boden
 * in einem davon sähe kein Gate. Den Nachweis, dass beide Zweige diese Funktion benutzen, führt
 * `CommandPalette.zeilenstil.test.tsx` über ein ersetzbares Modul.
 */
export function palettenZeilenStil(token: ZeilenToken) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: token.marginSM,
    minHeight: token.controlHeight,
    padding: `${token.paddingXS}px ${token.paddingSM}px`,
    borderRadius: form.radiusFlaeche,
    cursor: 'pointer',
  } as const;
}

/** Nur die Tokens, die das Vorschau-Ziel braucht — prüfbar ohne Render. */
export interface VorschauZielToken {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
  colorBorderSecondary: string;
}

/**
 * Das Tippziel „Vorschau“ rechts in einer Palettenzeile, der Weg in die Vorschau für Finger und
 * Maus.
 *
 * Handgebautes Bedienziel, also ZWEI Angaben: der Boden `controlHeight` in Höhe UND Breite plus
 * Polsterung; `border-box`, damit der Boden das ganze Quadrat meint.
 *
 * Die Zeile ist content-box und gepolstert (`palettenZeilenStil`); um genau diese Polsterung
 * zieht sich das Ziel nach rechts und in der Höhe heraus. Es endet bündig an der Zeilenkante und
 * füllt ihre volle Höhe, ohne einen Streifen daneben, der noch den Datensatz öffnete.
 */
export function vorschauZielStil(token: VorschauZielToken) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'stretch',
    boxSizing: 'border-box',
    minHeight: token.controlHeight,
    minWidth: token.controlHeight,
    padding: `${token.paddingXS}px ${token.paddingSM}px`,
    marginBlock: -token.paddingXS,
    marginInlineEnd: -token.paddingSM,
    borderInlineStart: `1px solid ${token.colorBorderSecondary}`,
    cursor: 'pointer',
  } as const;
}
