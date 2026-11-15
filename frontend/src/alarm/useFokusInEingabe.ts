import { useEffect, useState } from 'react';
import { istEingabefeld } from './useEingangshinweis';

/**
 * Ob gerade eine Eingabe läuft (LLH-1738, Spec `benachrichtigungen`, „Eine Leiste am
 * Handschirm“, design.md D5 in `openspec/changes/zu9ptja2-alarmzone/`): Fokus in einem Feld, das
 * Text oder eine Auswahl annimmt (`istEingabefeld`). Dann klappt die Leiste am Handschirm ein; die
 * Bildschirmtastatur braucht den Platz. Beim Wechsel von Feld zu Feld bleibt der Wert, denn
 * `focusin` des neuen Feldes kommt nach `focusout` des alten und setzt ihn zurück.
 */
export function useFokusInEingabe(): boolean {
  const [tippt, setTippt] = useState(() =>
    typeof document === 'undefined' ? false : istEingabefeld(document.activeElement),
  );
  useEffect(() => {
    const neu = () => setTippt(istEingabefeld(document.activeElement));
    const weg = (ev: FocusEvent) => setTippt(istEingabefeld(ev.relatedTarget as Element | null));
    document.addEventListener('focusin', neu);
    document.addEventListener('focusout', weg);
    return () => {
      document.removeEventListener('focusin', neu);
      document.removeEventListener('focusout', weg);
    };
  }, []);
  return tippt;
}
