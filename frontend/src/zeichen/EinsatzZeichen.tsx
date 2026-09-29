import { Einsatzzeichen } from '@einsatzzeichen/react';
import { useId, type CSSProperties } from 'react';
import type { TzProps } from '../pages/lagekarte/taktischesZeichen';
import { fachobjektZeichen } from './fachobjektZeichen';

/**
 * Das taktische Zeichen eines Fachobjekts als Inline-SVG über @einsatzzeichen (LFH-835). Übersetzt
 * das Hub-Vokabular über `fachobjektZeichen` (mit Rückfall) und rendert nichts, wenn nicht einmal
 * der Körper darstellbar ist — ein gespeicherter Unsinnswert bringt keine Zeile zum Absturz.
 * Jede Instanz trägt einen eigenen `idPrefix`: der Vorgabepräfix der Bibliothek ergäbe in Listen
 * doppelte `id`s.
 */
export default function EinsatzZeichen({
  tz,
  size,
  style,
}: {
  tz: TzProps;
  /** Kantenlänge in px, ganzzahlig (die Bibliothek verlangt es). */
  size: number;
  style?: CSSProperties;
}) {
  const idPrefix = `ez${useId()}`;
  const zeichen = fachobjektZeichen(tz);
  if (!zeichen) return null;
  return <Einsatzzeichen drawing={zeichen.drawing} size={size} idPrefix={idPrefix} style={style} />;
}
