/**
 * Tokens des Design Systems „Lifeline Hub“ (Change `uzfj5f43-design-system-aus-code`, design.md
 * D2): setzt Werte aus `src/theme/tokens.ts` in das Format des Artifact-Typs „Design System“ um.
 *
 * Das Format liest jede Familie (außer `type`) als LISTE `{ tokens: [{ name, value, usage }] }`,
 * Farben mit einem Wert je Thema. Namen `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`, über alle Familien
 * eindeutig. Farbwerte nur hex oder `rgb()`/`rgba()`/`hsl()`/`oklch()` ohne innere Funktion; was
 * das Format nicht liest (`var()`, `color-mix()`, ein Schatten), fällt weg und steht in der README
 * unter „Nur im Code“. `transparent` wird als `rgba(0, 0, 0, 0)` aufgelöst, dieselbe Farbe.
 *
 * Rein: was aus der App kommt, reicht `generate.tsx` herein, damit die Umsetzung ohne Render
 * prüfbar ist (`src/designSystem.test.ts`).
 */

/** Die Themen des Design Systems. Das erste ist die Vorgabe der App: Nachtbetrieb. */
export const THEMES = [
  { id: 'nacht', name: 'Nacht' },
  { id: 'tag', name: 'Tag' },
] as const;

export interface FarbToken {
  name: string;
  value: { nacht: string; tag: string };
  usage: string;
}

export interface Token {
  name: string;
  value: string;
  usage: string;
}

/** Ein Wert, der nicht ins Format passt, mit Grund — für die Liste „Nur im Code“. */
export interface Omitted {
  source: string;
  reason: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** Eine Farbfunktion ohne innere Funktion (also ohne `var()` oder `calc()` darin). */
const COLOR_FUNCTION = /^(?:rgb|rgba|hsl|hsla|oklch)\([^()]*\)$/;
const LENGTH = /^-?\d+(?:\.\d+)?(?:px|rem|em|%)?$/;

/** `linieStark` → `linie-stark`, `flaeche2` bleibt. */
export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function isValidName(name: string): boolean {
  return NAME.test(name);
}

export function isValidLength(value: string): boolean {
  return LENGTH.test(value);
}

/**
 * Ein Farbwert im Format des Typs, oder `null`, wenn er dort nicht lesbar ist. `transparent` wird
 * aufgelöst; andere benannte Farben, `var()`, `color-mix()` und Schatten fallen weg.
 */
export function formatFarbe(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === 'transparent') return 'rgba(0, 0, 0, 0)';
  if (HEX.test(trimmed) || COLOR_FUNCTION.test(trimmed)) return trimmed;
  return null;
}

/**
 * Farbtokens aus einer Quelle mit einem Wert je Thema, in der Reihenfolge der Nacht-Quelle. Ist
 * ein Wert in einem Thema nicht lesbar, fällt der ganze Schlüssel weg (ein Token mit nur einem
 * Thema wäre falsch) und landet in `omitted`.
 */
export function buildFarbTokens(
  prefix: string,
  source: string,
  nacht: Readonly<Record<string, string>>,
  tag: Readonly<Record<string, string>>,
  usage: (key: string) => string,
  omitted: Omitted[],
): FarbToken[] {
  const tokens: FarbToken[] = [];
  for (const key of Object.keys(nacht)) {
    const n = formatFarbe(nacht[key]);
    const t = formatFarbe(tag[key]);
    if (n == null || t == null) {
      omitted.push({
        source: `${source}.${key}`,
        reason: `kein Farbwert (Nacht \`${nacht[key]}\`, Tag \`${tag[key]}\`)`,
      });
      continue;
    }
    tokens.push({
      name: `${prefix}-${kebab(key)}`,
      value: { nacht: n, tag: t },
      usage: usage(key),
    });
  }
  return tokens;
}

/** Ein Längentoken in px. */
export function px(name: string, value: number, usage: string): Token {
  return { name, value: `${value}px`, usage };
}

/**
 * Prüft die Regeln des Formats über alle Familien außer `type`: gültige, eindeutige Namen,
 * lesbare Farben und Längen. Wirft mit allen Verstößen auf einmal.
 */
export function checkTokens(families: Record<string, readonly (Token | FarbToken)[]>): void {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const [family, tokens] of Object.entries(families)) {
    for (const token of tokens) {
      if (!isValidName(token.name)) errors.push(`${family}: ungültiger Name „${token.name}“`);
      const before = seen.get(token.name);
      if (before) errors.push(`${family}: „${token.name}“ steht schon in ${before}`);
      seen.set(token.name, family);
      if (!token.usage.trim()) errors.push(`${family}: „${token.name}“ ohne usage`);
      if (typeof token.value === 'string') {
        if (!isValidLength(token.value)) errors.push(`${family}: „${token.name}“ ist keine Länge`);
      } else {
        for (const value of Object.values(token.value)) {
          if (formatFarbe(value) !== value) errors.push(`${family}: „${token.name}“: ${value}`);
        }
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Design System: Tokens verletzen das Format:\n${errors.join('\n')}`);
  }
}
