/**
 * Marke einer Zelle mit Erläuterung (LLH-1110, Spec `gefahrenmatrix`): ein Dreieck in der Ecke oben
 * rechts. Zweiter Kanal ist die Form, nicht die Farbe (WCAG 1.4.1); die Farbe ist die des Kürzels
 * (`currentColor`), die auf jeder Stufenfläche den Textboden hält. Für Hilfstechnik verborgen, den
 * Hinweis trägt der Name der Zelle (`MIT_ERLAEUTERUNG`). Sie nimmt keine Zeigerereignisse an: die
 * ganze Zelle bleibt das Ziel (LLH-1102).
 *
 * EIN Baustein für Matrix, Lagebild-Paneel und Palettenauszug (LLH-1365): wer die Marke zeigt,
 * nimmt sie von hier, damit dieselbe Sache überall dasselbe Zeichen trägt.
 */
export const ERLAEUTERUNG_MARKE_KANTE = 8;

/** Die Marke selbst, absolut in der Ecke des nächsten positionierten Vorfahren (Zelle). */
export function ErlaeuterungsMarke() {
  return (
    <span
      aria-hidden="true"
      data-lfh="erlaeuterung-marke"
      style={{
        position: 'absolute',
        insetBlockStart: 0,
        insetInlineEnd: 0,
        width: 0,
        height: 0,
        borderInlineStart: `${ERLAEUTERUNG_MARKE_KANTE}px solid transparent`,
        borderBlockStart: `${ERLAEUTERUNG_MARKE_KANTE}px solid currentColor`,
        pointerEvents: 'none',
      }}
    />
  );
}

/**
 * Die Marke als Zeichen im Text: ein Kästchen von 1 em mit der Marke in seiner Ecke — für Legenden
 * und für Zeilen ohne eigene Zelle (Lagebild-Paneel). `lfh` benennt die Stelle für Tests.
 */
export function ErlaeuterungsZeichen({ lfh }: { lfh: string }) {
  return (
    <span
      aria-hidden="true"
      data-lfh={lfh}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: '1em',
        height: '1em',
        verticalAlign: '-0.15em',
      }}
    >
      <ErlaeuterungsMarke />
    </span>
  );
}
