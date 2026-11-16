import type { CSSProperties, ReactNode } from 'react';
import type { Farbrollen } from '../../theme/tokens';
import { schriftStil, useRollen } from './rollenwerte';

/**
 * Feldetikett — benennt ein Feld (LLH-1776, Spec `schriftrollen`): gemischt geschrieben, Stufe
 * `klein` (12 px in `kompakt`, wächst mit der Dichte), ohne Sperrung, Textstufe `gedaempft`.
 *
 * UMGEKEHRT 15.11.2026 gegenüber dem Neuentwurf: dort trug die Augenbraue (Versalien, Sperrung,
 * 10 px, `schwach`) auch die Feldetiketten. Gemessen war das die Suchspur jedes Formulars, nachts
 * bei 5,2–5,8 : 1. Versalien stehen jetzt nur noch in Köpfen (Paneel, Kennzahl, Tabellenkopf,
 * Rail); ein Feld benennt dieses Etikett. `Datenfeld`, `DatenfeldEingabe` und `FeldLabel` tragen
 * es, die Augenbraue kennt `als="dt"` nicht mehr.
 */
export function feldetikettStil(rollen: Pick<Farbrollen, 'gedaempft'>): CSSProperties {
  return {
    ...schriftStil('etikett'),
    lineHeight: 1.3,
    color: rollen.gedaempft,
    margin: 0,
  };
}

export type FeldetikettElement = 'span' | 'div' | 'dt' | 'label';

interface FeldetikettProps {
  children: ReactNode;
  /** Element; Vorgabe `span`. `dt` im Datenraster, `label` an einer Eingabe. */
  als?: FeldetikettElement;
  /** Nur mit `als="label"`: die Eingabe, die das Etikett benennt. */
  htmlFor?: string;
  id?: string;
  style?: CSSProperties;
  className?: string;
}

export default function Feldetikett({
  children,
  als: Element = 'span',
  htmlFor,
  id,
  style,
  className,
}: FeldetikettProps) {
  const { rollen } = useRollen();
  return (
    <Element
      id={id}
      htmlFor={Element === 'label' ? htmlFor : undefined}
      data-lfh="feldetikett"
      className={className}
      style={{ ...feldetikettStil(rollen), ...style }}
    >
      {children}
    </Element>
  );
}
