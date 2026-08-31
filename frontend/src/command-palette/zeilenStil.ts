// frontend/src/command-palette/zeilenStil.ts
import { form } from '../theme/tokens';

/** Nur die Tokens, die die Zeile braucht — so ist die Funktion ohne Render prüfbar. */
export interface ZeilenToken {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
  marginSM: number;
}

/**
 * Trefflächenboden und Grundform einer Palettenzeile (LFH-365, Nacharbeit zu LFH-335).
 *
 * Handgebautes Bedienziel: ZWEI Angaben, nicht eine — `minHeight` aus `controlHeight`
 * (30 / 48 / 72) plus Polsterung aus den Abstandsrollen. Die Palette ist seit LFH-335 der
 * Berührungsweg zu 42+ Befehlen; eine Zeile, die auf dem Führungs-Tablet 34 px hoch bleibt,
 * verfehlt genau den Kontext, für den der sichtbare Auslöser gebaut wurde. Radius 0 statt
 * eines Festwerts ist die Formensprache aus LFH-352.
 *
 * Aufgelöste Tokens, nie `var(--lfh-*)`: die Arbeitsteilung steht in `theme/rollen.css`
 * („ZWEI QUELLEN, EINE WAHRHEIT") — handgeschriebenes CSS liest die Custom Properties, TSX
 * liest `theme.useToken()`. Präzedenz: `pages/lagekarte/Sidebar.tsx` (`bedienzielStil`).
 *
 * EIGENES MODUL, nicht neben der Komponente (LFH-391 · A3): seit A3 rendert die Palette zwei
 * Zweige — flach bei aktiver Suche, gruppiert bei leerer. Ginge der Boden in einem der beiden
 * verloren, sähe das kein Gate (`dichte.guard.test.ts` kennt Größen-Props, keine
 * Pixel-Polsterung). Der Nachweis „der flache Zweig benutzt WIRKLICH diese Funktion" braucht
 * ein ersetzbares Modul; eine Funktion in der getesteten Datei lässt sich nicht ersetzen.
 * Siehe `CommandPalette.zeilenstil.test.tsx`.
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
