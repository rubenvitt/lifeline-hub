import type { HTMLAttributes, ReactNode } from 'react';
import { theme } from 'antd';
import { form } from '../theme/tokens';

/**
 * Stil der Kürzel-Marke — rein und exportiert (Muster `bedienzielStil`), damit die Zusicherung
 * ohne Rendern prüfbar ist: `test/utils.tsx` montiert ein nacktes `ConfigProvider`.
 *
 * Die Farbe kommt aus `currentColor` statt aus einer Farbrolle: dieselbe Marke steht auf dem
 * dunklen Kopfzeilengrund (Such-Trigger, erbt `--lfh-kopf-vordergrund`) und auf Containergrund
 * in der Palette. Ein fester Rollenwert wäre an einer der beiden Stellen unsichtbar.
 *
 * Radius 0 ist die Formensprache (`form.radiusMarke`), keine vergessene Rundung.
 *
 * KEIN Bedienziel: ein `<kbd>` ist Satz, kein Ziel, und bekommt deshalb KEINEN
 * `controlHeight`-Boden (der stünde in `handschuh` bei 72 px neben einer Zeile Text).
 */
export function tastenkuerzelStil(token: {
  paddingXS: number;
  fontSizeSM: number;
  fontFamilyCode: string;
}) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid currentColor',
    borderRadius: form.radiusMarke,
    padding: `0 ${token.paddingXS}px`,
    fontFamily: token.fontFamilyCode,
    fontSize: token.fontSizeSM,
    lineHeight: 1.6,
    whiteSpace: 'nowrap',
  } as const;
}

type Props = HTMLAttributes<HTMLElement> & { children: ReactNode };

/**
 * Sichtbare Tastenkürzel-Marke (`<kbd>`). Ohne sie fällt ein `<kbd>` auf die Browser-Vorgabe
 * zurück: Monospace, kein Rahmen, kein Abstand zum Nachbartext („Suchen⌘K" in einem Zug).
 */
export default function Tastenkuerzel({ children, style, ...rest }: Props) {
  const { token } = theme.useToken();
  return (
    <kbd {...rest} style={{ ...tastenkuerzelStil(token), ...style }}>
      {children}
    </kbd>
  );
}
