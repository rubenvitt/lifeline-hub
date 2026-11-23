import type { CSSProperties, ReactNode } from 'react';
import type { Farbrollen } from '../../theme/tokens';
import { schriftStil, useRollen } from './rollenwerte';

/**
 * Feldetikett — benennt ein Feld (LLH-2045, Regel `frontend/AGENTS.md`, „Gestaltungssprache“,
 * Bausteine): Stufe `textKlein` (12 px, fest wie jede Stufe, ADR-0093), Ton `gedaempft`, gemischt
 * geschrieben, ohne Sperrung.
 *
 * UMGEKEHRT 22.11.2026 gegenüber dem Neuentwurf: dort trug die Augenbraue (10 px, Versalien,
 * Sperrung, `schwach`) auch die Feldnamen, die Suchspur jedes Datenrasters und Formulars. Versalien
 * stehen jetzt nur noch in Köpfen (Paneel, Kennzahl, Tabellen- und Gruppenkopf, Rail); ein Feld
 * benennt dieses Etikett. `Datenfeld`, `DatenfeldEingabe` und `FeldLabel` tragen es, die
 * Augenbraue kennt `als="dt"` nicht mehr.
 *
 * Bewusst ohne `style` (wie `Textstufe`): Abstand trägt das umgebende Element.
 */
export function feldetikettStil(rollen: Pick<Farbrollen, 'gedaempft'>): CSSProperties {
  return {
    ...schriftStil('textKlein'),
    lineHeight: 1.3,
    color: rollen.gedaempft,
    margin: 0,
  };
}

export type FeldetikettElement = 'span' | 'div' | 'dt' | 'label';

export interface FeldetikettProps {
  children: ReactNode;
  /** Element; Vorgabe `span`. `dt` im Datenraster, `label` über einer Eingabe. */
  als?: FeldetikettElement;
  /** Nur mit `als="label"`: die `id` der Eingabe, die das Etikett benennt. */
  htmlFor?: string;
  id?: string;
  className?: string;
}

export default function Feldetikett({
  children,
  als: Element = 'span',
  htmlFor,
  id,
  className,
}: FeldetikettProps) {
  const { rollen } = useRollen();
  return (
    <Element
      id={id}
      className={className}
      data-lfh="feldetikett"
      {...(Element === 'label' && htmlFor ? { htmlFor } : {})}
      style={feldetikettStil(rollen)}
    >
      {children}
    </Element>
  );
}
