import type { CSSProperties, ReactNode } from 'react';
import { theme } from 'antd';
import { UEBERLAGERUNG_RAND, kartenKnopfKante } from './KartenUeberlagerung';

/** Abstand der Fußleiste zum Kartenrand und zwischen ihren Bändern (px). */
export const FUSS_ABSTAND = 12;

export type BandAusrichtung = 'voll' | 'mitte' | 'links';

/**
 * Stil eines Bandes im Fuß-Rahmen — rein und exportiert. `pointerEvents: 'auto'` ist die Gegenzeile
 * zu `'none'` am Rahmen und gehört an jedes Band, sonst ist es sichtbar und tot.
 */
export function bandStil(
  ausrichtung: BandAusrichtung = 'voll',
  /**
   * Das Band gibt Höhe ab, wenn der Fuß nicht in die Karte passt, und rollt dann in sich. Genau ein
   * Band trägt das: die Zeitachse, das höchste und am ehesten verzichtbare.
   */
  nachgiebig = false,
): CSSProperties {
  return {
    pointerEvents: 'auto',
    ...(nachgiebig ? { minHeight: 0, overflowY: 'auto' as const } : {}),
    alignSelf:
      ausrichtung === 'mitte' ? 'center' : ausrichtung === 'links' ? 'flex-start' : 'stretch',
    // Ein Band darf den Rahmen nie überlaufen, sonst käme die Überdeckung über die Breite zurück.
    maxWidth: '100%',
  };
}

/**
 * Stil des Fuß-Rahmens — rein und exportiert.
 *
 * Rechts endet der Fuß vor der Knopfspalte: Knopfblock und Fuß lagen beide auf `zIndex: 5`, und der
 * Fuß verdeckte Kartenknöpfe vollständig (Zeiger und Tastatur). Die Abhilfe ist eine Aufteilung der
 * Breite, kein `zIndex`: zwei Flächen, die sich die Breite teilen, überschneiden sich bei keiner
 * Höhe. Der Preis ist ein um die Knopfspalte schmaleres Band.
 */
export function fussStil(knopfKante: number): CSSProperties {
  return {
    position: 'absolute',
    left: FUSS_ABSTAND,
    right: UEBERLAGERUNG_RAND + knopfKante + FUSS_ABSTAND,
    bottom: FUSS_ABSTAND,
    zIndex: 5,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: FUSS_ABSTAND,
    // Oben endet der Fuß an der Karte: unten verankert und ohne Obergrenze wuchs er in den
    // Seitenkopf. Der Rahmen spannt bis zur Oberkante und stapelt nach unten; was nicht passt, gibt
    // die Zeitachse ab (`nachgiebig`). Bewusst kein `overflow` am Rahmen — es schnitte Schatten und
    // Fokusringe der Bänder ab.
    top: FUSS_ABSTAND,
    justifyContent: 'flex-end',
    // Der Rahmen trägt selbst nichts: ohne diese Zeile schluckte der Leerraum zwischen den Bändern
    // jedes Ziehen und Klicken auf der Karte. Die Bänder holen sich die Ereignisse über `bandStil`
    // zurück.
    pointerEvents: 'none',
  };
}

/**
 * Gemeinsamer unterer Rand der Lagekarte (LFH-355).
 *
 * `ZeichnenSteuerung` und `SnapshotLeiste` lagen beide absolut auf `zIndex: 5` am selben Rand; die
 * Leiste verdeckte „Abschließen"/„Abbrechen" vollständig. Ein höherer `zIndex` hätte den Klick
 * zurückgeholt und die Überdeckung gelassen. Der Rahmen stapelt die Bänder stattdessen als
 * Flow-Geschwister in einer Spalte — zwei Elemente im Fluss können sich nicht überlagern. Deshalb
 * geben die Bänder ihre absolute Positionierung ab; wer sie einem zurückgibt, holt den Bug wieder.
 *
 * Die Zeichnen-Steuerung steht oben und schwenkt über der Leiste ein; sie erscheint nur im
 * Zeichenmodus.
 */
export function KartenFuss({ children }: { children?: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div data-lfh="karten-fuss" style={fussStil(kartenKnopfKante(token))}>
      {children}
    </div>
  );
}
