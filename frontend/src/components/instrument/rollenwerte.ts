import { theme, type GlobalToken } from 'antd';
import {
  farbenDunkel,
  farbenHell,
  schrift,
  schriftskala,
  type Farbrollen,
  type Schriftstufenname,
} from '../../theme/tokens';

/**
 * Die Farbrollen des AKTIVEN Modus für die Instrumenten-Bausteine (Neuentwurf
 * „Instrumententafel", `docs/design/2026-09-21-neuentwurf/umsetzung.md`).
 *
 * WARUM NICHT NUR `theme.useToken()`: antd kennt `paneel`, `kopf`, `flaeche3`, `text2`,
 * die deckenden Statusflächen, das Sammelbanner und die Zeilentönungen nicht —
 * `antdToken()` bildet sie auf keinen Token ab. TSX liest sie deshalb aus den Paletten in
 * `theme/tokens.ts`, CSS aus `--lfh-*` in `theme/rollen.css` (die Arbeitsteilung „ZWEI
 * QUELLEN, EINE WAHRHEIT"). Kein Farbwert steht hier — Gate 5.
 *
 * DER MODUS: dieselbe Helligkeitsprobe auf `colorBgBase`, die `theme/statusFarben.ts`
 * (`istDunklerModus`, dort privat) für `marke`, Flächen, ETB-Typ und Warnstufenbalken
 * fährt — nicht `useThemeMode().effektiv`. Der Kontext liefert ohne Provider `dark`
 * (Vorgabe seit dem Neuentwurf), das antd-Theme eines blanken `ConfigProvider` ist aber
 * hell: zwei Quellen würden im Test zwei Modi melden. Die Probe am Token hängt dagegen an
 * genau dem Theme, das auch die antd-Flächen daneben färbt. Ein fremdes Theme fällt auf
 * Hell zurück, statt zu werfen.
 */
export function istDunkel(token: Pick<GlobalToken, 'colorBgBase'>): boolean {
  const kurz = token.colorBgBase.trim().replace('#', '');
  const hex = kurz.length === 3 ? [...kurz].map((z) => z + z).join('') : kurz;
  if (hex.length < 6) return false;
  const wert = Number.parseInt(hex.slice(0, 6), 16);
  if (Number.isNaN(wert)) return false;
  // Relative Helligkeit nach ITU-R BT.709 — dieselbe Gewichtung wie in statusFarben.ts.
  const helligkeit =
    0.2126 * ((wert >> 16) & 255) + 0.7152 * ((wert >> 8) & 255) + 0.0722 * (wert & 255);
  return helligkeit < 128;
}

/** Die Farbrollen des Modus, den `token` beschreibt. Rein — ohne Render prüfbar. */
export function rollenwerte(token: Pick<GlobalToken, 'colorBgBase'>): Farbrollen {
  return istDunkel(token) ? farbenDunkel : farbenHell;
}

/** Token und Rollen in einem Griff — der Standardzugang aller Bausteine. */
export function useRollen(): { token: GlobalToken; rollen: Farbrollen; dunkel: boolean } {
  const { token } = theme.useToken();
  const dunkel = istDunkel(token);
  return { token, rollen: dunkel ? farbenDunkel : farbenHell, dunkel };
}

/**
 * Eine Stufe der Schriftskala als Inline-Stil. Familie aus `schrift`, Werte aus
 * `schriftskala` — keine zweite Skala. Zahlenfamilien bekommen `tabular-nums` mit
 * (Signatur 3: Ziffernflattern ist ein Lesefehler).
 */
export function schriftStil(stufe: Schriftstufenname) {
  const s: {
    groesse: number;
    gewicht: number;
    familie: keyof typeof schrift;
    sperrung?: string;
    versal?: boolean;
  } = schriftskala[stufe];
  return {
    fontFamily: schrift[s.familie],
    fontSize: s.groesse,
    fontWeight: s.gewicht,
    ...(s.sperrung ? { letterSpacing: s.sperrung } : {}),
    ...(s.versal ? { textTransform: 'uppercase' as const } : {}),
    ...(s.familie === 'zahl' ? { fontVariantNumeric: 'tabular-nums' as const } : {}),
  };
}

/** Die Stufen der `schriftskala` in der Familie `zahl` (Mono). */
export type Monostufe = {
  [K in Schriftstufenname]: (typeof schriftskala)[K]['familie'] extends 'zahl' ? K : never;
}[Schriftstufenname];

/**
 * Mono-Text in einer Stufe der `schriftskala` (`metaKlein` 10 · `meta` 11 · `monoKlein` 12 ·
 * `mono` 13 · `monoGross` 14 · `datenwert*`; LLH-1972). Die Stufe liefert Größe und, ohne
 * `gewicht`, ihr Gewicht — ihre Sperrung NICHT: wer sie will, setzt sie selbst.
 *
 * Eine Zahl nur aus einer Variablen (Dichte-Grundschrift `token.fontSize*`, Kartenmaße), dann
 * mit Gewicht 400. Ein Zahl-Literal zählt `theme/schriftgroesse.guard.test.ts` als freie Größe.
 */
export function monoStil(groesse: Monostufe | number, gewicht?: 400 | 500) {
  const stufe = typeof groesse === 'number' ? undefined : schriftskala[groesse];
  return {
    fontFamily: schrift.zahl,
    fontSize: stufe ? stufe.groesse : (groesse as number),
    fontWeight: gewicht ?? stufe?.gewicht ?? 400,
    fontVariantNumeric: 'tabular-nums' as const,
  };
}
