import type { CSSProperties, ReactNode } from 'react';
import type { Farbrollen, Schriftstufenname } from '../../theme/tokens';
import { schriftStil, useRollen } from './rollenwerte';

/**
 * Schrift — Text in einer Rolle der Schriftskala (LLH-1775, Spec `schriftskala`). Die Größe ist
 * die CSS-Variable der Stufe und wächst mit der Dichte; jede Rolle setzt gleich breite Ziffern.
 * Für Stellen ohne eigenen Baustein, die eine Größe brauchen: statt `fontSize` mit einer Zahl
 * (macht `theme/schriftLiteral.guard.test.ts` rot). Ein antd-Element, das nur einen `style`
 * nimmt, liest `schriftStil(rolle)` bzw. `schriftGroesse(stufe)` aus `./rollenwerte`.
 *
 * Der Name ist nicht `Text`: viele Dateien importieren antds `Typography.Text` als `Text`.
 */
export type SchriftTon = Extract<keyof Farbrollen, 'text' | 'text2' | 'gedaempft' | 'schwach'>;

export type SchriftElement = 'span' | 'div' | 'p' | 'strong' | 'small';

interface SchriftProps {
  rolle: Schriftstufenname;
  children: ReactNode;
  /** Element; Vorgabe `span`. */
  als?: SchriftElement;
  /** Textstufe; ohne Angabe erbt der Text die Farbe der Umgebung. */
  ton?: SchriftTon;
  id?: string;
  style?: CSSProperties;
  className?: string;
}

export default function Schrift({
  rolle,
  children,
  als: Element = 'span',
  ton,
  id,
  style,
  className,
}: SchriftProps) {
  const { rollen } = useRollen();
  return (
    <Element
      id={id}
      className={className}
      style={{
        ...schriftStil(rolle),
        ...(Element === 'p' || Element === 'div' ? { margin: 0 } : {}),
        ...(ton ? { color: rollen[ton] } : {}),
        ...style,
      }}
    >
      {children}
    </Element>
  );
}
