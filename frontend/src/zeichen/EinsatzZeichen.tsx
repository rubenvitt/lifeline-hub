import { Einsatzzeichen } from '@einsatzzeichen/react';
import type { Drawing } from '@einsatzzeichen/schema';
import { useId, type CSSProperties } from 'react';
import type { TzProps } from '../pages/lagekarte/taktischesZeichen';
import {
  fachobjektZeichen,
  funktionsZeichen,
  type FunktionsZeichenEingabe,
} from './fachobjektZeichen';
import { ZEICHEN_UNTERLAGE } from './unterlage';

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
  unterlage = false,
}: {
  tz: TzProps;
  /** Kantenlänge in px, ganzzahlig (die Bibliothek verlangt es). */
  size: number;
  style?: CSSProperties;
  /**
   * Helle Unterlage ({@link ZEICHEN_UNTERLAGE}) am Schirm. Sie deckt genau das Quadrat des
   * Zeichens (die Bibliothek lässt darin rund 3 % Rand um den Umriss), das Zeichen wird nicht
   * größer. Im Druck fällt sie ohne eigene Regel: in der Druckwurzel nimmt `druck/druck.css` jeden
   * Hintergrund weg, außerhalb steht nichts auf dem Blatt. Nur in HTML: im SVG einer Skizze malt ein inneres `svg` keinen
   * Hintergrund, dort trägt ein `rect` die Unterlage (`stab/skizze/SkizzenElemente.tsx`).
   */
  unterlage?: boolean;
}) {
  const idPrefix = `ez${useId()}`;
  const zeichen = fachobjektZeichen(tz);
  if (!zeichen) return null;
  return (
    <Einsatzzeichen
      drawing={zeichen.drawing}
      size={size}
      idPrefix={idPrefix}
      style={unterlage ? { ...style, backgroundColor: ZEICHEN_UNTERLAGE } : style}
    />
  );
}

/** Ein Funktionszeichen (LFH-1029, `funktionsZeichen`), sonst wie {@link EinsatzZeichen}. */
export function FunktionsZeichen({
  funktion,
  size,
}: {
  funktion: FunktionsZeichenEingabe;
  /** Kantenlänge in px, ganzzahlig. */
  size: number;
}) {
  const idPrefix = `ez${useId()}`;
  const zeichen = funktionsZeichen(funktion);
  if (!zeichen) return null;
  return <Einsatzzeichen drawing={zeichen.drawing} size={size} idPrefix={idPrefix} />;
}

/**
 * Eine fertige Zeichnung (etwa aus dem Leseadapter `freiesZeichen` oder dem Vokabular des Pickers,
 * LFH-836) als Inline-SVG, mit eigenem `idPrefix` je Instanz wie {@link EinsatzZeichen}.
 */
export function ZeichenBild({
  drawing,
  size,
  style,
}: {
  drawing: Drawing;
  /** Kantenlänge in px, ganzzahlig. */
  size: number;
  style?: CSSProperties;
}) {
  const idPrefix = `ez${useId()}`;
  return <Einsatzzeichen drawing={drawing} size={size} idPrefix={idPrefix} style={style} />;
}
