import type { ReactNode } from 'react';
import type { Farbrollen, Schriftstufenname } from '../../theme/tokens';
import { schriftStil, useRollen } from './rollenwerte';

/**
 * Textstufe — Text in einer Stufe der `schriftskala` und einem Ton (Spec `schriftstufen`,
 * LLH-1810). Größe, Gewicht, Familie, Sperrung und Versalien kommen aus der Stufe, die Farbe aus
 * der Rolle des aktiven Modus. Die Größen sind fest und wachsen nicht mit der Dichte: antds
 * Grundschrift steigt schon, „der Handschuh ändert die Hand, nicht das Auge" (`theme/tokens.ts`).
 *
 * Bewusst ohne `style`: eine freie Schriftgröße käme sonst durch die Hintertür. Das Element ist
 * wählbar (`als`), die Optik bleibt dieselbe — die Gliederung gehört in den Baum, nicht ins
 * Aussehen. Regel: `frontend/AGENTS.md`, „Gestaltungssprache“, Bausteine.
 */

export type Textton = 'text' | 'text2' | 'gedaempft' | 'schwach' | 'alarm';

export type TextstufeElement =
  'span' | 'p' | 'div' | 'label' | 'dt' | 'dd' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

const TON_ROLLE: Record<Textton, keyof Farbrollen> = {
  text: 'text',
  text2: 'text2',
  gedaempft: 'gedaempft',
  schwach: 'schwach',
  alarm: 'alarmText',
};

export function textstufeFarbe(rollen: Farbrollen, ton: Textton): string {
  return rollen[TON_ROLLE[ton]] as string;
}

export interface TextstufeProps {
  children: ReactNode;
  /** Stufe der Skala; Vorgabe `text`. */
  stufe?: Schriftstufenname;
  /** Farbrolle; Vorgabe `text`. */
  ton?: Textton;
  /** Semantisches Element; Vorgabe `span`. */
  als?: TextstufeElement;
  /** `ueberall` bricht auch lange Wörter (Namen, Funkrufnamen) statt die Zeile zu sprengen. */
  umbruch?: 'normal' | 'ueberall';
  id?: string;
  className?: string;
  title?: string;
  htmlFor?: string;
}

export default function Textstufe({
  children,
  stufe = 'text',
  ton = 'text',
  als: Element = 'span',
  umbruch = 'normal',
  id,
  className,
  title,
  htmlFor,
}: TextstufeProps) {
  const { rollen } = useRollen();
  return (
    <Element
      id={id}
      className={className}
      title={title}
      {...(Element === 'label' && htmlFor ? { htmlFor } : {})}
      style={{
        ...schriftStil(stufe),
        lineHeight: stufe === 'kartentitel' ? 1.4 : 1.5,
        color: textstufeFarbe(rollen, ton),
        margin: 0,
        ...(umbruch === 'ueberall' ? { overflowWrap: 'anywhere' as const } : {}),
      }}
    >
      {children}
    </Element>
  );
}
