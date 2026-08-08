import type { HTMLAttributes, ReactNode } from 'react';
import { theme } from 'antd';
import { form } from '../theme/tokens';

/**
 * Stil der Kürzel-Marke — rein und exportiert nach dem Muster von `bedienzielStil`
 * (`pages/lagekarte/Sidebar.tsx`), damit die Zusicherung ohne Rendern prüfbar ist:
 * `test/utils.tsx` montiert ein nacktes `ConfigProvider` ohne unser Theme, eine
 * gerenderte Messung belegte also antd-Vorgaben statt der Rollen.
 *
 * Die Farbe kommt bewusst aus `currentColor` statt aus einer Farbrolle: dieselbe
 * Marke steht einmal auf dem dunklen Kopfzeilengrund (Such-Trigger, der dort
 * `--lfh-kopf-vordergrund` erbt) und einmal auf Containergrund in der Palette. Ein
 * fester Rollenwert wäre an genau einer der beiden Stellen unsichtbar — das ist
 * dieselbe Überlegung, die den Kopfzeilen-Knöpfen in `einsatz/EinsatzLayout.tsx`
 * ihre Vordergrundrolle gibt.
 *
 * Radius 0 ist die Formensprache aus LFH-352 (`form.radiusMarke`), keine vergessene
 * Rundung — vorher trug die Palette hier einen handgeschriebenen Wert 6.
 *
 * KEIN Bedienziel: ein `<kbd>` ist Satz, kein Ziel. Es bekommt deshalb bewusst
 * KEINEN `controlHeight`-Boden — der stünde in der Stufe `handschuh` bei 72 px
 * neben einer Zeile Text. Dieselbe Trennung, aus der `dichte.guard.test.ts` die
 * nicht-interaktiven Flächen (`Card`, `Descriptions`) heraushält.
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
 * Sichtbare Tastenkürzel-Marke (`<kbd>`).
 *
 * Ohne sie fällt ein `<kbd>` auf die Browser-Vorgabe zurück: Systemschrift-Monospace,
 * kein Rahmen, kein Abstand zum Nachbartext — in der Kopfzeile stand deshalb
 * gemessen „Suchen⌘K" in einem Zug.
 */
export default function Tastenkuerzel({ children, style, ...rest }: Props) {
  const { token } = theme.useToken();
  return (
    <kbd {...rest} style={{ ...tastenkuerzelStil(token), ...style }}>
      {children}
    </kbd>
  );
}
