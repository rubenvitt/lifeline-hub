import type { CSSProperties, ReactNode } from 'react';
import type { Farbrollen } from '../../theme/tokens';
import { schriftStil, useRollen } from './rollenwerte';

/**
 * Augenbraue — die Kopf-Stimme des Neuentwurfs: Stufe `fein` (11 px), 600, Versalien, Sperrung
 * .08em, Farbe `schwach` (`schriftskala.augenbraue`). Sie benennt NUR Köpfe: Paneele,
 * Kennzahlen, Tabellenspalten, Gruppen (LLH-1776, Spec `schriftrollen`). Ein Feld benennt das
 * `Feldetikett` (gemischt geschrieben, `gedaempft`); deshalb kennt `als` kein `dt` mehr
 * (umgekehrt 15.11.2026 gegenüber dem Neuentwurf, der auch Feldetiketten so setzte).
 *
 * Standard ist ein `<span>` (Satz, kein Gliederungspunkt). Wo die Augenbraue eine
 * Sektion BENENNT — Paneelkopf, Kennzahl —, macht `als="h2"` … `"h6"` sie zur Überschrift,
 * ohne dass die Optik sich ändert: die Gliederung gehört in den Baum, nicht ins Aussehen.
 *
 * Die Versalien sind CSS (`text-transform`), der Text im DOM bleibt, wie er übergeben
 * wird — Vorleser buchstabieren sonst „B-E-T-R-O-F-F-E-N-E".
 */
export function augenbraueStil(rollen: Pick<Farbrollen, 'schwach'>): CSSProperties {
  return {
    ...schriftStil('augenbraue'),
    lineHeight: 1.3,
    color: rollen.schwach,
    margin: 0,
  };
}

export type AugenbraueElement = 'span' | 'div' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

interface AugenbraueProps {
  children: ReactNode;
  /** Semantisches Element; Vorgabe `span`. */
  als?: AugenbraueElement;
  id?: string;
  style?: CSSProperties;
  className?: string;
}

export default function Augenbraue({
  children,
  als: Element = 'span',
  id,
  style,
  className,
}: AugenbraueProps) {
  const { rollen } = useRollen();
  return (
    <Element
      id={id}
      className={['lfh-augenbraue', className].filter(Boolean).join(' ')}
      style={{ ...augenbraueStil(rollen), ...style }}
    >
      {children}
    </Element>
  );
}
