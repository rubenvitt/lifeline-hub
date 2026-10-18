import { useEffect, useState } from 'react';

/**
 * „Nach oben“ im ETB: in Funkprotokoll-Ordnung öffnet die Seite am Ende (`etb/AGENTS.md`,
 * Funkprotokoll-Ordnung), Filterleiste und „Ältere laden“ stehen oben. Der Knopf erscheint erst,
 * wenn mehr als eine Fensterhöhe darüber liegt — kürzer erreicht man sie mit einem Wisch.
 */
export function isWeitGerollt(scrollY: number, fensterHoehe: number): boolean {
  return scrollY > fensterHoehe;
}

/** Folgt dem Bildlauf am Dokument; gemessen nur im Zuhörer, gedrosselt auf einen Rahmen. */
export function useWeitGerollt(): boolean {
  const [weit, setWeit] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => setWeit(isWeitGerollt(window.scrollY, window.innerHeight));
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return weit;
}

/** Rollt an den Seitenanfang; ohne Bewegung, wenn das System reduzierte Bewegung wünscht. */
export function scrollNachOben() {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  window.scrollTo?.({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
}
