import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Fokusrückgabe nach dem Verlassen einer Inline-Bearbeitung (LFH-369, herausgelöst mit LFH-472
 * für `BemerkungZelle` und `InlineAngabe`).
 *
 * Beide Bauteile tauschen beim Öffnen den Auslöser-Knopf gegen eine Eingabe und beim Verlassen
 * zurück. Der Fokus fiele dabei auf `<body>`:
 *
 * 1. **Abbrechen / leer geblieben:** die Eingabe hängt in derselben Runde aus, in der der Knopf
 *    zurückkommt.
 * 2. **Gespeichert, Wert kommt NACH:** der neue Wert trifft per Invalidierung erst eine Runde
 *    später ein, und ein FRISCHER Knopf (Wert- statt Platzhalterknopf) ersetzt den alten.
 *
 * Deshalb ein Merker, der den Zweigwechsel ÜBERLEBT, statt einer Flanke auf `bearbeitet`.
 *
 * Ohne Deps-Array: der Effekt muss auch laufen, wenn sich nur der Wert ändert. Eingegriffen wird
 * NUR bei verwaistem Fokus (`activeElement === body`); sitzt er woanders, fällt der Merker.
 *
 * `useLayoutEffect` wie antd: vor dem Anstrich, damit der Fokus nicht sichtbar springt.
 *
 * @returns Ref für den Auslöser-Knopf. EIN Ref für alle Knopfvarianten, weil nie zwei davon
 *   gleichzeitig im Baum stehen.
 */
export function useFokusRueckgabe(bearbeitet: boolean): RefObject<HTMLButtonElement | null> {
  const knopfRef = useRef<HTMLButtonElement>(null);
  const fokusZurueck = useRef(false);

  useLayoutEffect(() => {
    if (bearbeitet) {
      fokusZurueck.current = true;
      return;
    }
    if (!fokusZurueck.current) return;
    const ziel = knopfRef.current;
    if (!ziel) return;
    if (document.activeElement === document.body || document.activeElement === null) ziel.focus();
    else fokusZurueck.current = false;
  });

  return knopfRef;
}
