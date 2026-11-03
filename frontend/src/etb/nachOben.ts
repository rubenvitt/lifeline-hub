import { useEffect, useState } from 'react';
import { useRahmenOben } from '../components/rahmenOben';

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

/**
 * Ab welchem Anteil ein Knopf als ganz unter dem Rahmen gilt. Knapp unter 1: Chromium meldet für ein
 * ganz enthaltenes Ziel auf Bruchteil-Pixeln mitunter 0,999…, und ein Pixel Überlappung verdeckt
 * nichts.
 */
export const GANZ_FREI_AB = 0.98;

/**
 * Passt der Knopf ganz zwischen den klebenden Rahmen oben (`--lfh-rahmen-oben`) und die
 * Erfassungsleiste unten (LLH-1386)? Die Überlagerung der Zeitachse hängt über der Leiste und
 * stapelt nach oben: ist die Leiste hoch (Hinweise, Anhangliste, Berichtigungswarnung) und das
 * Fenster niedrig, rutscht „Nach oben“ ganz hinter den Kopf und bliebe dort ein Tab-Stopp, den
 * niemand sieht. Dann steht er unsichtbar (`visibility: hidden`: kein Tab-Stopp, kein Vorleser,
 * aber weiter vermessen), bis wieder Platz ist.
 *
 * Gemessen über einen `IntersectionObserver`, dessen Wurzel oben um den Rahmen gekürzt ist: er
 * meldet jede Lageänderung — Bildlauf, Fenstergröße, wachsende Leiste, eintreffendes Banner —
 * ohne eigene Zuhörer. Ohne ihn (jsdom) gilt der Knopf als frei.
 */
export function useNachObenPasst(): [boolean, (el: HTMLElement | null) => void] {
  const rahmenOben = useRahmenOben();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [passt, setPasst] = useState(true);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const beobachter = new IntersectionObserver(
      (eintraege) => {
        const letzter = eintraege[eintraege.length - 1];
        setPasst(letzter.isIntersecting && letzter.intersectionRatio >= GANZ_FREI_AB);
      },
      { rootMargin: `-${rahmenOben}px 0px 0px 0px`, threshold: [0, GANZ_FREI_AB, 1] },
    );
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [el, rahmenOben]);
  return [passt, setEl];
}

/**
 * Springt an den Seitenanfang, ohne Bewegung wie `rolleAnsEnde` in
 * `components/useFunkprotokollLauf.ts`: ein weicher Lauf über ein langes Tagebuch dauert, und
 * die Medienabfrage für reduzierte Bewegung gehört `useViewport` (`useViewport.guard.test.ts`).
 */
export function scrollNachOben() {
  window.scrollTo?.({ top: 0, behavior: 'instant' });
}
