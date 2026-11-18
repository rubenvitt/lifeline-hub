import type { AriaAttributes, CSSProperties, ReactNode } from 'react';
import { theme, type GlobalToken } from 'antd';
import type { Abstandsraster } from '../../theme/tokens';

/**
 * Stapel — reiht Elemente senkrecht (Vorgabe) oder waagerecht mit einem Abstand aus dem Raster
 * der aktiven Dichte (Spec `abstandsraster`, „Stapel nehmen nur Rasterstufen", LLH-1810). Der
 * Abstand ist eine Stufe `xxs`…`xl`, nie eine Zahl; er kommt aus antds Token, die `antdToken()`
 * je Dichte aus `dichten[*].abstand` setzt, und wächst so mit `komfortabel` und `handschuh`.
 *
 * Ersetzt `Space direction="vertical"`, `Flex vertical gap` und `flexDirection: 'column'` mit
 * erfundenem `gap`. Bewusst ohne `style`. Regel: `frontend/AGENTS.md`, „Gestaltungssprache“,
 * Abstandsraster und Bausteine.
 */

export type Abstandsstufe = keyof Abstandsraster;

/** Rasterstufe → antd-Token; MD = LG wie in `antdToken`. */
const TOKEN: Record<Abstandsstufe, keyof GlobalToken> = {
  xxs: 'paddingXXS',
  xs: 'paddingXS',
  sm: 'paddingSM',
  md: 'padding',
  lg: 'paddingLG',
  xl: 'paddingXL',
};

/** Die Rasterstufe als Pixelwert der aktiven Dichte — für Bausteine, die selbst einen Abstand setzen. */
export function rasterAbstand(token: GlobalToken, stufe: Abstandsstufe): number {
  return token[TOKEN[stufe]] as number;
}

const AUSRICHTEN = {
  start: 'flex-start',
  mitte: 'center',
  ende: 'flex-end',
  baseline: 'baseline',
  strecken: 'stretch',
} as const;

const VERTEILEN = {
  start: 'flex-start',
  mitte: 'center',
  ende: 'flex-end',
  between: 'space-between',
} as const;

type StapelElement = 'div' | 'section' | 'ul' | 'ol' | 'li' | 'nav' | 'header' | 'footer' | 'span';

export interface StapelProps extends Pick<AriaAttributes, 'aria-label' | 'aria-labelledby'> {
  children: ReactNode;
  /** Rasterstufe der Lücke; Vorgabe `sm`. */
  abstand?: Abstandsstufe;
  /** `spalte` (Vorgabe) stapelt senkrecht, `zeile` reiht waagerecht. */
  richtung?: 'spalte' | 'zeile';
  /** Umbruch in die nächste Reihe, wenn die Breite nicht reicht. */
  umbruch?: boolean;
  ausrichten?: keyof typeof AUSRICHTEN;
  verteilen?: keyof typeof VERTEILEN;
  /** Füllt den Platz im Elternstapel (wachsen 1, Basis 0). */
  wachsen?: boolean;
  als?: StapelElement;
  id?: string;
  className?: string;
  role?: string;
}

export default function Stapel({
  children,
  abstand = 'sm',
  richtung = 'spalte',
  umbruch = false,
  ausrichten,
  verteilen,
  wachsen = false,
  als: Element = 'div',
  id,
  className,
  role,
  ...aria
}: StapelProps) {
  const { token } = theme.useToken();
  const liste = Element === 'ul' || Element === 'ol';
  const stil: CSSProperties = {
    display: 'flex',
    flexDirection: richtung === 'zeile' ? 'row' : 'column',
    gap: rasterAbstand(token, abstand),
    minWidth: 0,
    ...(umbruch ? { flexWrap: 'wrap' } : {}),
    ...(ausrichten ? { alignItems: AUSRICHTEN[ausrichten] } : {}),
    ...(verteilen ? { justifyContent: VERTEILEN[verteilen] } : {}),
    ...(wachsen ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : {}),
    ...(liste ? { margin: 0, padding: 0, listStyle: 'none' } : {}),
  };
  return (
    <Element id={id} className={className} role={role} style={stil} {...aria}>
      {children}
    </Element>
  );
}
