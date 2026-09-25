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

/** Nur die Tokens, die das Vorschau-Ziel braucht — prüfbar ohne Render. */
export interface VorschauZielToken {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
  colorBorderSecondary: string;
}

/**
 * Das Tippziel „Vorschau" rechts in einer Palettenzeile (LFH-665).
 *
 * Seit LFH-645 öffnet → die Lese-Vorschau, aber nur per Tastatur. Auf Tablet und Handschirm
 * öffnete jeder Tipp die Zeile selbst. Dieses Ziel ist der zweite Weg hinein, für Finger und
 * Maus.
 *
 * Handgebautes Bedienziel, also ZWEI Angaben (LFH-365): der Boden `controlHeight` in Höhe
 * UND Breite, dazu die Polsterung aus den Abstandsrollen. `border-box`, damit der Boden das
 * ganze Quadrat meint und nicht nur sein Inneres.
 *
 * DIE TRENNUNG VON DER ZEILE ist die eigentliche Aufgabe, und sie folgt aus dem Layout statt
 * aus einer Zahl: die Zeile ist content-box und gepolstert (`palettenZeilenStil`). Um genau
 * diese Polsterung zieht sich das Ziel nach rechts (`marginInlineEnd`) und in der Höhe
 * (`marginBlock` plus `stretch`) heraus. Es endet bündig an der Zeilenkante und füllt ihre
 * volle Höhe; ein Streifen, der daneben noch zur Zeile gehörte und dort den Datensatz
 * öffnete, entsteht nicht. Die Linie links macht die Grenze sichtbar.
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
