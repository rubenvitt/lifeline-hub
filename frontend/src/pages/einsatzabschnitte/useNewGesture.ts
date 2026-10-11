import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Hat seit dem Öffnen eines Dialogs eine NEUE Geste begonnen (Taste gedrückt oder losgelassen,
 * Zeiger gedrückt)? (LFH-1212)
 *
 * Wählt die Tastatur einen Eintrag von „Weitere Aktionen“, öffnet der Dialog schon beim `keydown`.
 * antd setzt den Fokus dann auf das erste Ziel im Dialog (das Schließkreuz), und das `keypress`
 * DESSELBEN Enter löst es aus: der Dialog ging sofort wieder zu (gemessen in
 * `e2e/abschnitte-umhaengen.spec.ts`). Bis eine neue Geste beginnt, nimmt der Dialog deshalb keine
 * Handlung an. Ein gehaltenes Enter (`repeat`) zählt nicht als neue Geste.
 *
 * `useLayoutEffect`, damit die Hörer stehen, bevor der Browser das nächste Eingabeereignis liefert.
 */
export function useNewGesture(offen: boolean): () => boolean {
  const neu = useRef(false);
  useLayoutEffect(() => {
    neu.current = false;
    if (!offen) return;
    const frei = (e: Event) => {
      if (e instanceof KeyboardEvent && e.type === 'keydown' && e.repeat) return;
      neu.current = true;
    };
    const arten = ['keydown', 'keyup', 'pointerdown'] as const;
    for (const art of arten) document.addEventListener(art, frei, true);
    return () => {
      for (const art of arten) document.removeEventListener(art, frei, true);
    };
  }, [offen]);
  return useCallback(() => neu.current, []);
}
