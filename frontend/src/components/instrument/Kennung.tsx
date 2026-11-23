import type { CSSProperties, ReactNode } from 'react';
import { monoStil, type Monostufe } from './rollenwerte';

export interface KennungProps {
  /** Stufe der Mono-Familie (`schriftskala`); ohne Angabe `mono` (13 px). */
  stufe?: Monostufe;
  gewicht?: 400 | 500;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}

/**
 * Funkrufname oder andere Kennung in Mono (ADR-0094: Mono trägt nur Zahl, Zeit, Kennung und
 * Funkrufname). Ein Funkrufname enthält Wörter („Florian Musterstadt 46/11-1“) und steht trotzdem
 * in Mono; `data-schrift="kennung"` sagt das dem e2e-Wächter `e2e/mono-ohne-worte.spec.ts`, der
 * sonst jedes Wort in Mono meldet.
 */
export default function Kennung({
  stufe = 'mono',
  gewicht,
  style,
  className,
  children,
}: KennungProps) {
  return (
    <span
      data-schrift="kennung"
      className={className}
      style={{ ...monoStil(stufe, gewicht), ...style }}
    >
      {children}
    </span>
  );
}
