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
 * Zwei Wege tragen sie: in HTML der Hintergrund von `EinsatzZeichen` (Prop `unterlage`), im SVG
 * der Skizze ein `rect` (`stab/skizze/SkizzenElemente.tsx`).
 */
export const ZEICHEN_UNTERLAGE = farbenHell.flaeche;
