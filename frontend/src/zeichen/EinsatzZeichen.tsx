import type { RenderTheme } from '@einsatzzeichen/core';
import { Einsatzzeichen } from '@einsatzzeichen/react';
import type { Drawing } from '@einsatzzeichen/schema';
import { useId, type CSSProperties } from 'react';
import type { TzProps } from '../pages/lagekarte/taktischesZeichen';
import {
  fachobjektZeichen,
  funktionsZeichen,
  type FunktionsZeichenEingabe,
} from './fachobjektZeichen';

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
  theme,
}: {
  tz: TzProps;
  /** Kantenlänge in px, ganzzahlig (die Bibliothek verlangt es). */
  size: number;
  style?: CSSProperties;
  /**
   * Render-Theme der Bibliothek, `undefined` = Referenzpalette. Nachts am Schirm
   * `ZEICHEN_THEME_DUNKEL` (LLH-1409, `zeichen/zeichenTheme.ts`, in React `useZeichenTheme`): das
   * Zeichen selbst hell hinterlegt statt auf einer hellen Fläche; im Druck keins.
   */
  theme?: RenderTheme;
}) {
  const idPrefix = `ez${useId()}`;
  const zeichen = fachobjektZeichen(tz);
  if (!zeichen) return null;
  return (
    <Einsatzzeichen
      drawing={zeichen.drawing}
      size={size}
      idPrefix={idPrefix}
      theme={theme}
      style={style}
    />
  );
}

/** Ein Funktionszeichen (LFH-1029, `funktionsZeichen`), sonst wie {@link EinsatzZeichen}. */
export function FunktionsZeichen({
  funktion,
  size,
  theme,
}: {
  funktion: FunktionsZeichenEingabe;
  /** Kantenlänge in px, ganzzahlig. */
  size: number;
  /** Render-Theme wie bei {@link EinsatzZeichen}. */
  theme?: RenderTheme;
}) {
  const idPrefix = `ez${useId()}`;
  const zeichen = funktionsZeichen(funktion);
  if (!zeichen) return null;
  return <Einsatzzeichen drawing={zeichen.drawing} size={size} idPrefix={idPrefix} theme={theme} />;
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
