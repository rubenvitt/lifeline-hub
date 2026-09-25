import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Steht die Seite gerade im Druck? `true` zwischen `beforeprint` und `afterprint` (LFH-71).
 *
 * Für Bausteine, deren DRUCKFORM sich nicht per CSS herstellen lässt — heute die stehende
 * Kopfzeile der `KatalogTabelle`: mit `sticky` liegt der Kopf in einer eigenen Tabelle, und
 * keine Druckregel führt ihn wieder mit dem Körper zusammen. Am Bildschirm bleibt alles, wie
 * es ist; nur für das Druckbild rendert der Baustein anders.
 *
 * BEIDE WEGE laufen hierüber: Strg+P (der Browser feuert `beforeprint`) und der Knopf
 * („Drucken / als PDF" → `useDrucken` → `window.print()`, das `beforeprint` synchron
 * feuert). `flushSync`, weil der Browser das Druckbild direkt nach den Listenern einfriert —
 * ein normal eingeplantes Update käme danach. Das trägt nur, solange `window.print()` NICHT
 * aus einem React-Effekt heraus gerufen wird (dort rendert `flushSync` nicht); das sichert
 * `useDrucken` zu.
 *
 * Nicht erfasst: `page.pdf()` in Playwright und `emulateMedia` feuern kein `beforeprint`.
 * Die e2e-Prüfung löst das Ereignis deshalb selbst aus.
 */
export function useDruckModus(): boolean {
  const [druckt, setDruckt] = useState(false);
  useEffect(() => {
    const vor = () => flushSync(() => setDruckt(true));
    const nach = () => setDruckt(false);
    window.addEventListener('beforeprint', vor);
    window.addEventListener('afterprint', nach);
    return () => {
      window.removeEventListener('beforeprint', vor);
      window.removeEventListener('afterprint', nach);
    };
  }, []);
  return druckt;
}
