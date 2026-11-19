import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigation, useNavigationType, type Location } from 'react-router';
import {
  liesRolle,
  loescheRolle,
  merkeRolle,
  ROLL_FRIST_MS,
  traegtZiel,
} from '../routing/rollGedaechtnis';

/** Eingaben, mit denen die Person selbst übernimmt: die Wiederherstellung gibt dann auf. */
const EIGENE_EINGABE = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Schlüssel eines Verlaufseintrags im Gedächtnis. Ein frisch geladener Eintrag ohne eigenen
 * Schlüssel heißt bei react-router immer `default`; er gilt deshalb nur für dieselbe Adresse,
 * sonst rollte ein später geöffnetes Lesezeichen auf die Position einer anderen Seite.
 */
function schluesselVon(location: Location): string {
  return location.key === 'default'
    ? `default:${location.pathname}${location.search}`
    : location.key;
}

/**
 * Rollposition beim Zurück wiederherstellen (LLH-1826, Entwurf D5; Regel `frontend/AGENTS.md`,
 * „Rollposition beim Zurück“). Am Stab rollt das Dokument; in der Gerätehülle rollt das `main`,
 * dort ist sie deshalb nicht montiert.
 *
 * - POP (Zurück, Vorwärts, Neuladen): zur gemerkten Position, sobald die Seite hoch genug ist.
 *   Die Daten kommen per React Query erst nach dem ersten Zeichnen; bis dahin wächst die Seite,
 *   höchstens {@link ROLL_FRIST_MS}. Eigene Eingabe bricht ab, ein Deeplink-Ziel hat Vorrang.
 * - PUSH: oben beginnen. REPLACE (Filterwechsel, Reiter) ist derselbe Platz im Verlauf: die
 *   Position und eine laufende Wiederherstellung gehen mit, der alte Schlüssel fällt weg.
 */
export default function RollWiederherstellung(): null {
  const location = useLocation();
  const navigationType = useNavigationType();
  // Letzte Position aus dem Scroll-Ereignis: beim Verlassen hat der Browser die Position für die
  // neue, oft kürzere Seite schon geklemmt. Über REPLACE hinweg bleibt sie stehen.
  const zuletzt = useRef<number | undefined>(undefined);
  /** Bricht eine laufende Wiederherstellung ab; REPLACE lässt sie weiterlaufen. */
  const abbrechen = useRef<(() => void) | null>(null);
  const vorigerSchluessel = useRef<string | null>(null);
  const schluessel = schluesselVon(location);
  // Während die nächste Seite lädt, steht noch die alte Adresse, aber oft schon ein kürzeres
  // Gerippe: der Browser klemmt die Position, und das Ereignis gehörte nicht zur alten Seite.
  const laedt = useNavigation().state !== 'idle';
  const laedtRef = useRef(laedt);
  laedtRef.current = laedt;

  useEffect(() => {
    const vorher = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const merke = () => {
      if (!laedtRef.current) zuletzt.current = window.scrollY;
    };
    window.addEventListener('scroll', merke, { passive: true });
    return () => {
      history.scrollRestoration = vorher;
      window.removeEventListener('scroll', merke);
      abbrechen.current?.();
    };
  }, []);

  useEffect(() => {
    const beimVerlassen = () => merkeRolle(schluessel, zuletzt.current ?? window.scrollY);
    window.addEventListener('pagehide', beimVerlassen);
    return () => window.removeEventListener('pagehide', beimVerlassen);
  }, [schluessel]);

  useLayoutEffect(() => {
    // Läuft die Wiederherstellung noch, ist die Position nicht die der Person: die gemerkte bleibt
    // (StrictMode baut den Effekt beim Einhängen einmal probeweise ab, ein Neuladen ebenso früh).
    let wiederherstellungOffen = false;
    const merkeBeimVerlassen = () => {
      if (wiederherstellungOffen) return;
      merkeRolle(schluessel, zuletzt.current ?? window.scrollY);
    };

    if (navigationType === 'REPLACE') {
      // Derselbe Platz im Verlauf: der vorige Schlüssel ist tot, die Position geht mit.
      if (vorigerSchluessel.current != null && vorigerSchluessel.current !== schluessel) {
        loescheRolle(vorigerSchluessel.current);
      }
      vorigerSchluessel.current = schluessel;
      return merkeBeimVerlassen;
    }
    vorigerSchluessel.current = schluessel;
    abbrechen.current?.();
    abbrechen.current = null;

    if (navigationType === 'PUSH') {
      window.scrollTo(0, 0);
      zuletzt.current = 0;
      return merkeBeimVerlassen;
    }
    // POP
    zuletzt.current = window.scrollY;
    const y = liesRolle(schluessel);
    if (y === undefined || traegtZiel(new URLSearchParams(location.search))) {
      return merkeBeimVerlassen;
    }

    let fertig = false;
    wiederherstellungOffen = true;
    let beobachter: ResizeObserver | undefined;
    const aufhoeren = () => {
      if (fertig) return;
      fertig = true;
      beobachter?.disconnect();
      clearTimeout(frist);
      for (const art of EIGENE_EINGABE) window.removeEventListener(art, aufhoeren);
      if (abbrechen.current === aufhoeren) abbrechen.current = null;
    };
    const versuche = () => {
      if (fertig) return;
      if (document.documentElement.scrollHeight - window.innerHeight >= y) {
        window.scrollTo(0, y);
        zuletzt.current = y;
        wiederherstellungOffen = false;
        aufhoeren();
      }
    };
    const frist = setTimeout(aufhoeren, ROLL_FRIST_MS);
    for (const art of EIGENE_EINGABE) {
      window.addEventListener(art, aufhoeren, { passive: true });
    }
    abbrechen.current = aufhoeren;
    versuche();
    if (!fertig && typeof ResizeObserver !== 'undefined') {
      beobachter = new ResizeObserver(versuche);
      beobachter.observe(document.documentElement);
      beobachter.observe(document.body);
    }
    return () => {
      // Abbruch ohne Ziel (Frist, eigene Eingabe): ab dann zählt die Position der Person.
      if (fertig) wiederherstellungOffen = false;
      merkeBeimVerlassen();
    };
    // `location.search` gehört zum Schlüssel; getaktet wird über Schlüssel und Art.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel, navigationType]);

  return null;
}
