import { useCallback, type ReactNode } from 'react';

/**
 * Begrenzt eine Arbeitsfläche auf die verbleibende Fensterhöhe (LFH-459).
 * Flexbox verteilt die Resthöhe nach dem gemessenen äußeren Abstand. Der echte
 * Kopf plus Mindest-Arbeitsfläche bildet den Boden für kleine Fenster/lange Köpfe.
 * Das Dokument scrollt dann weiter, ebenso zu den Inhalten nach diesem Rahmen.
 */
export default function FensterRahmen({
  kopf,
  children,
  mindestHoehe = 0,
}: {
  kopf: ReactNode;
  children: ReactNode;
  /** Nutzbare Mindesthöhe der Arbeitsfläche, unabhängig von der Kopfhöhe. */
  mindestHoehe?: number;
}) {
  const rahmenRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const kopfElement = el.firstElementChild as HTMLElement;
      const messen = () => {
        // Dokumentkoordinate: ein Resize beim Lesen der nachfolgenden Reiter darf
        // die Arbeitsfläche nicht um die bereits gescrollte Strecke vergrößern.
        const oben = el.getBoundingClientRect().top + window.scrollY;
        // Lange Notizen dürfen die Arbeitsfläche nicht verdrängen. Der Mindestbedarf
        // enthält die GEMESSENE Kopfhöhe, keine dichteabhängige Schätzung.
        const mindestbedarf = kopfElement.getBoundingClientRect().height + mindestHoehe;
        el.style.height = `max(${mindestbedarf}px, calc(100dvh - ${oben}px - var(--lfh-seiten-polsterung, 0px)))`;
      };
      messen();
      // Ein Style-Write im ResizeObserver würde erneut die beobachteten Vorfahren
      // vermessen lassen (Browserfehler: undelivered notifications). Ein Frame
      // bündelt die Änderungen außerhalb dieser Auslieferungsrunde.
      let frame: number | undefined;
      const messungPlanen = () => {
        if (frame != null) return;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          messen();
        });
      };
      // Der Rahmen kann erst nach dem Laden erscheinen. Der Callback-Ref misst
      // genau dann und räumt auch beim Routenwechsel auf (React-19-Ref-Cleanup).
      // Vorfahren mitbeobachten: z. B. die App-Kopfzeile wächst beim Dichtewechsel,
      // auch wenn weder Fensterbreite noch unsere eigene Inhaltsbreite wechseln.
      const observer = new ResizeObserver(messungPlanen);
      observer.observe(kopfElement);
      for (let knoten: HTMLElement | null = el; knoten; knoten = knoten.parentElement) {
        observer.observe(knoten);
      }
      window.addEventListener('resize', messungPlanen);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', messungPlanen);
        if (frame != null) cancelAnimationFrame(frame);
      };
    },
    [mindestHoehe],
  );

  return (
    <div ref={rahmenRef} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0 }}>{kopf}</div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
