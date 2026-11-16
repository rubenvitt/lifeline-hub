import { theme, type GlobalToken } from 'antd';
import {
  farbenDunkel,
  farbenHell,
  schrift,
  schriftskala,
  type Farbrollen,
  type Groessenstufe,
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
 * Die Schriftgröße einer Stufe als Stilwert (LLH-1775, Spec `schriftskala`): die CSS-Variable
 * `--lfh-groesse-<stufe>`, die mit der Dichte wächst und beim ersten Bild stimmt. Der einzige Weg
 * zu einer Größe außerhalb des Themes; ein Zahlwert macht `theme/schriftLiteral.guard.test.ts`
 * rot. Wer eine Zahl rechnen muss, nimmt `schriftPx` aus `theme/tokens.ts`.
 */
export function schriftGroesse(stufe: Groessenstufe): string {
  return `var(--lfh-groesse-${stufe})`;
}

/**
 * Eine Rolle der Schriftskala als Inline-Stil. Familie aus `schrift`, Werte aus `schriftskala` —
 * keine zweite Skala. Jede Rolle setzt gleich breite Ziffern (LLH-1777): auch Wörter mit Zahlen
 * („Stand 14:32“) stehen in der Textschrift und flattern nicht.
 */
export function schriftStil(rolle: Schriftstufenname) {
  const s: {
    stufe: Groessenstufe;
    gewicht: number;
    familie: keyof typeof schrift;
    sperrung?: string;
    versal?: boolean;
  } = schriftskala[rolle];
  return {
    fontFamily: schrift[s.familie],
    fontSize: schriftGroesse(s.stufe),
    fontWeight: s.gewicht,
    ...(s.sperrung ? { letterSpacing: s.sperrung } : {}),
    ...(s.versal ? { textTransform: 'uppercase' as const } : {}),
    fontVariantNumeric: 'tabular-nums' as const,
  };
}

/**
 * Mono für Zahl, Zeit, Kennung und Funkrufname (LLH-1777, Spec `schriftrollen`), in einer Stufe
 * der Skala. Text mit Wörtern nimmt `schriftStil`, nie diesen Helfer.
 */
export function zahlStil(stufe: Groessenstufe, gewicht: 400 | 500 = 400) {
  return {
    fontFamily: schrift.zahl,
    fontSize: schriftGroesse(stufe),
    fontWeight: gewicht,
    fontVariantNumeric: 'tabular-nums' as const,
  };
}
