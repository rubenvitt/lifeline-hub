import { Einsatzzeichen } from '@einsatzzeichen/react';
import { useId, type CSSProperties } from 'react';
import type { TzProps } from '../pages/lagekarte/taktischesZeichen';
import { farbenHell } from '../theme/tokens';
import {
  fachobjektZeichen,
  funktionsZeichen,
  type FunktionsZeichenEingabe,
} from './fachobjektZeichen';

/**
 * Helle Unterlage hinter einem taktischen Zeichen am Schirm (LFH-1107, als Baustein LFH-1120):
 * Zeichen ohne Organisation zeichnet die Bibliothek mit schwarzem Umriss ohne Fläche, auf dem
 * Grund des Nachtbetriebs hielt er nur rund 1,1 : 1. Die Unterlage ist Papier
 * (`farbenHell.flaeche`), das Zeichen steht darauf wie im Druck, seine Farben nach DV 102 bleiben
 * unverfälscht; am Tag hebt sie sich vom Weiß kaum ab, von getönten Flächen als helles Quadrat.
 * Gemessen in beiden Modi im e2e „Zeichenkontrast“ (`fernmeldeskizze-ausstattung.spec.ts`,
 * `zeichen-kontrast.spec.ts`).
 */
export const ZEICHEN_UNTERLAGE = farbenHell.flaeche;

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
