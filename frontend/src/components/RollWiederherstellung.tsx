import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { liesRolle, merkeRolle, ROLL_FRIST_MS, traegtZiel } from '../routing/rollGedaechtnis';

/** Eingaben, mit denen die Person selbst übernimmt: die Wiederherstellung gibt dann auf. */
const EIGENE_EINGABE = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Rollposition beim Zurück wiederherstellen (LLH-1826, Entwurf D5; Regel `frontend/AGENTS.md`,
 * „Rollposition“). Am Stab rollt das Dokument; in der Gerätehülle rollt das `main`, dort ist
 * sie deshalb nicht montiert.
 *
 * - POP (Zurück, Vorwärts, Neuladen): zur gemerkten Position, sobald die Seite hoch genug ist.
 *   Die Daten kommen per React Query erst nach dem ersten Zeichnen; bis dahin wächst die Seite,
 *   höchstens {@link ROLL_FRIST_MS}. Eigene Eingabe bricht ab, ein Deeplink-Ziel hat Vorrang.
 * - PUSH: oben beginnen. REPLACE (Filterwechsel, Reiter): nichts tun.
 */
export default function RollWiederherstellung(): null {
  const location = useLocation();
  const navigationType = useNavigationType();
  // Letzte Position auf diesem Eintrag aus dem Scroll-Ereignis: im Aufräumen hat der Browser die
  // Position für die neue, oft kürzere Seite schon geklemmt.
  const zuletzt = useRef<number | undefined>(undefined);

  useEffect(() => {
    const vorher = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      history.scrollRestoration = vorher;
    };
  }, []);

  useEffect(() => {
    const merke = () => {
      zuletzt.current = window.scrollY;
    };
    const beimVerlassen = () => merkeRolle(location.key, zuletzt.current ?? window.scrollY);
    window.addEventListener('scroll', merke, { passive: true });
    window.addEventListener('pagehide', beimVerlassen);
    return () => {
      window.removeEventListener('scroll', merke);
      window.removeEventListener('pagehide', beimVerlassen);
    };
  }, [location.key]);

  useLayoutEffect(() => {
    const key = location.key;
    const merkeBeimVerlassen = () => {
      merkeRolle(key, zuletzt.current ?? window.scrollY);
      zuletzt.current = undefined;
    };

    if (navigationType === 'PUSH') {
      window.scrollTo(0, 0);
      return merkeBeimVerlassen;
    }
    if (navigationType !== 'POP') return merkeBeimVerlassen;
    const y = liesRolle(key);
    if (y === undefined || traegtZiel(new URLSearchParams(location.search))) {
      return merkeBeimVerlassen;
    }

    let fertig = false;
    let beobachter: ResizeObserver | undefined;
    const aufhoeren = () => {
      if (fertig) return;
      fertig = true;
      beobachter?.disconnect();
      clearTimeout(frist);
      for (const art of EIGENE_EINGABE) window.removeEventListener(art, aufhoeren);
    };
    const versuche = () => {
      if (fertig) return;
      if (document.documentElement.scrollHeight - window.innerHeight >= y) {
        window.scrollTo(0, y);
        aufhoeren();
      }
    };
    const frist = setTimeout(aufhoeren, ROLL_FRIST_MS);
    for (const art of EIGENE_EINGABE) {
      window.addEventListener(art, aufhoeren, { passive: true });
    }
    versuche();
    if (!fertig && typeof ResizeObserver !== 'undefined') {
      beobachter = new ResizeObserver(versuche);
      beobachter.observe(document.documentElement);
      beobachter.observe(document.body);
    }
    return () => {
      aufhoeren();
      merkeBeimVerlassen();
    };
  }, [location.key, location.search, navigationType]);

  return null;
}
