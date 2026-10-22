import { farbenHell } from '../theme/tokens';

/**
 * Helle Unterlage hinter einem taktischen Zeichen am Schirm (LFH-1107, als Baustein LFH-1120):
 * Zeichen ohne Organisation zeichnet die Bibliothek mit schwarzem Umriss ohne Fläche, auf dem
 * Grund des Nachtbetriebs hielt er nur rund 1,1 : 1. Die Unterlage ist Papier
 * (`farbenHell.flaeche`), das Zeichen steht darauf wie im Druck, seine Farben nach DV 102 bleiben
 * unverfälscht; am Tag hebt sie sich vom Weiß kaum ab, von getönten Flächen als helles Quadrat.
 * Gemessen in beiden Modi im e2e „Zeichenkontrast“ (`fernmeldeskizze-ausstattung.spec.ts`,
 * `zeichen-kontrast.spec.ts`).
 *
 * Drei Wege tragen sie: in HTML der Hintergrund von `EinsatzZeichen` (Prop `unterlage`), im SVG
 * der Skizze ein `rect` (`stab/skizze/SkizzenElemente.tsx`), im Rasterbild der Lagekarte
 * {@link legeAufUnterlage} (LLH-1141, nur bei dunkler Kartengrundlage).
 */
export const ZEICHEN_UNTERLAGE = farbenHell.flaeche;

/** Ein RGBA-Rasterbild, wie es `createStyleImage` (@einsatzzeichen/maplibre) liefert. */
export interface Rasterbild {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const UNTERLAGE_RGB = [1, 3, 5].map((i) => Number.parseInt(ZEICHEN_UNTERLAGE.slice(i, i + 2), 16));

/**
 * Legt ein gerastertes Zeichen auf die Unterlage (LLH-1141): jedes Pixel „über“ die deckende
 * Unterlage gemischt, das Ergebnis ist durchweg deckend. Wie in HTML deckt die Unterlage genau das
 * Quadrat des Zeichens (rund 3 % Rand um den Umriss), das Bild wird nicht größer. Die Farben des
 * Zeichens nach DV 102 bleiben, wo sie deckend sind, unverändert; nur Kantenglättung mischt sich mit
 * dem Papier statt mit dem Kartengrund. Rein: das Ausgangsbild bleibt, wie es ist.
 */
export function legeAufUnterlage(bild: Rasterbild): Rasterbild {
  const data = new Uint8ClampedArray(bild.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = bild.data[i + 3] / 255;
    for (let k = 0; k < 3; k++) {
      data[i + k] = Math.round(bild.data[i + k] * a + UNTERLAGE_RGB[k] * (1 - a));
    }
    data[i + 3] = 255;
  }
  return { width: bild.width, height: bild.height, data };
}
