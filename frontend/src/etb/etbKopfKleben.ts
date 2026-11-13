import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { useRahmenOben } from '../components/rahmenOben';

/**
 * Seitenkopf, Filterleiste und Spaltenkopf des ETB kleben unter dem Rahmen (kwc2yszv D8, Spec
 * `etb-filterleiste`, „Eine Filterleiste über der Zeitachse“; `frontend/AGENTS.md`, „Wer oben
 * klebt, hängt sich unter den Rahmen“). Ein gesetzter Filter bleibt so an der Arbeitsposition — am
 * Ende der Zeitachse, über der Erfassung — sichtbar und löschbar.
 *
 * GEMESSEN wie der Rahmen (`components/rahmenOben.ts`): Seitenkopf und Filterleiste brechen mit
 * Breite und Dichte um. Die Höhen stehen als CSS-Variablen am `<html>`, solange die Köpfe kleben:
 *  - `top` der Filterleiste: Rahmen + Seitenkopf,
 *  - {@link ETB_KOPF_UNTERKANTE} am Seitencontainer: Rahmen + Seitenkopf + Filterleiste — dort
 *    klebt der Spaltenkopf der Zeitachse (`top: var(--etb-kopf-unterkante, var(--lfh-rahmen-oben,
 *    0px))`, Vertrag mit `etb/EtbSpaltenzeile.tsx`),
 *  - der Fokusabstand oben (`scroll-padding-block-start`, `index.css`): dazu der Spaltenkopf, den
 *    die Seite unter `[data-lfh="etb-spaltenkopf"]` findet.
 *
 * NUR, WENN ES PASST: oben klebend und unten die angepinnte Erfassung ließen auf einem niedrigen
 * Fenster der Zeitachse keinen Platz, ein getabbtes Ziel läge ganz verdeckt (WCAG 2.4.11,
 * `e2e/fokus-verdeckung.spec.ts`, 1366 × 520 im Handschuh-Betrieb). Die Köpfe kleben deshalb nur,
 * solange sie mit dem Rahmen höchstens {@link KLEBEN_HOECHSTENS} der Fensterhöhe nehmen; sonst
 * rollen sie mit wie bisher. Unter `md` klebt nichts (wie der Rahmen, LFH-952).
 */

/** Höhe des klebenden Seitenkopfs (`EinsatzSeite kopfKlebt`). */
export const ETB_SEITENKOPF_HOEHE = '--lfh-etb-seitenkopf-hoehe';
/** Höhe der klebenden Filterleiste samt ihrem Abstand nach unten. */
export const ETB_FILTERLEISTE_HOEHE = '--lfh-etb-filterleiste-hoehe';
/** Höhe des Spaltenkopfs der Zeitachse, nur für den Fokusabstand. */
export const ETB_SPALTENKOPF_HOEHE = '--lfh-etb-spaltenkopf-hoehe';
/** Unterkante von Seitenkopf und Filterleiste, gesetzt am Seitencontainer des ETB. */
export const ETB_KOPF_UNTERKANTE = '--etb-kopf-unterkante';
export const ETB_KOPF_UNTERKANTE_WERT = `calc(var(--lfh-rahmen-oben, 0px) + var(${ETB_SEITENKOPF_HOEHE}, 0px) + var(${ETB_FILTERLEISTE_HOEHE}, 0px))`;
/** `top` der klebenden Filterleiste: unter Rahmen und Seitenkopf. */
export const ETB_FILTERLEISTE_OBEN = `calc(var(--lfh-rahmen-oben, 0px) + var(${ETB_SEITENKOPF_HOEHE}, 0px))`;

/** Höchstens dieser Anteil der Fensterhöhe darf oben kleben (Rahmen eingerechnet). */
export const KLEBEN_HOECHSTENS = 1 / 3;

interface Hoehen {
  rahmen: number;
  seitenkopf: number;
  filterleiste: number;
  spaltenkopf: number;
  fenster: number;
}

/** Passen die klebenden Köpfe ins Fenster? Rein und exportiert. */
export function kopfKlebtImFenster(h: Hoehen): boolean {
  return h.rahmen + h.seitenkopf + h.filterleiste + h.spaltenkopf <= h.fenster * KLEBEN_HOECHSTENS;
}

// Die Summe der klebenden ETB-Köpfe unter dem Rahmen, für Messungen außerhalb der Seite
// („Nach oben“, `etb/nachOben.ts`). 0, solange nichts klebt.
let kopfSumme = 0;
const hoerer = new Set<() => void>();
function setzeKopfSumme(neu: number) {
  if (neu === kopfSumme) return;
  kopfSumme = neu;
  for (const h of hoerer) h();
}

/** Höhe der klebenden ETB-Köpfe unter dem Rahmen in px; 0, wenn sie nicht kleben. */
export function useEtbKopfHoehe(): number {
  return useSyncExternalStore(
    (h) => {
      hoerer.add(h);
      return () => hoerer.delete(h);
    },
    () => kopfSumme,
    () => kopfSumme,
  );
}

const GEMESSEN_NULL = { seitenkopf: 0, filterleiste: 0, spaltenkopf: 0 };

/**
 * Misst Seitenkopf, Filterleiste und Spaltenkopf und entscheidet, ob sie kleben. Die Refs sind
 * Callback-Refs (wie `useRahmenObenQuelle`): tauscht React ein Element, beobachtet der Effekt das
 * neue. Gemessen im Layout-Effekt, danach ein Bild später je `ResizeObserver` und Fenstergröße.
 */
export function useEtbKopfKleben(aktiv: boolean) {
  const rahmen = useRahmenOben();
  const [seitenkopf, setSeitenkopf] = useState<HTMLElement | null>(null);
  const [filterleiste, setFilterleiste] = useState<HTMLElement | null>(null);
  const [zeitachse, setZeitachse] = useState<HTMLElement | null>(null);
  const [gemessen, setGemessen] = useState(GEMESSEN_NULL);
  const [fenster, setFenster] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerHeight,
  );

  useLayoutEffect(() => {
    if (!aktiv) return undefined;
    const messen = () => {
      const spaltenkopf = zeitachse?.querySelector<HTMLElement>('[data-lfh="etb-spaltenkopf"]');
      const neu = {
        seitenkopf: seitenkopf?.offsetHeight ?? 0,
        filterleiste: filterleiste?.offsetHeight ?? 0,
        spaltenkopf: spaltenkopf?.offsetHeight ?? 0,
      };
      setGemessen((alt) =>
        alt.seitenkopf === neu.seitenkopf &&
        alt.filterleiste === neu.filterleiste &&
        alt.spaltenkopf === neu.spaltenkopf
          ? alt
          : neu,
      );
      setFenster(window.innerHeight);
    };
    messen();
    // Nicht im Beobachter schreiben: die Variablen verändern, was an ihnen hängt (dieselbe Falle
    // wie `rahmenOben.ts`, LLH-1335). Ein Bild später.
    let geplant = 0;
    const planen = () => {
      if (geplant) return;
      geplant = requestAnimationFrame(() => {
        geplant = 0;
        messen();
      });
    };
    const beobachter = new ResizeObserver(planen);
    for (const el of [seitenkopf, filterleiste, zeitachse]) if (el) beobachter.observe(el);
    window.addEventListener('resize', planen);
    return () => {
      beobachter.disconnect();
      window.removeEventListener('resize', planen);
      if (geplant) cancelAnimationFrame(geplant);
    };
  }, [aktiv, seitenkopf, filterleiste, zeitachse]);

  const klebt = aktiv && kopfKlebtImFenster({ rahmen, fenster, ...gemessen });

  useLayoutEffect(() => {
    if (!klebt) return undefined;
    const stil = document.documentElement.style;
    stil.setProperty(ETB_SEITENKOPF_HOEHE, `${gemessen.seitenkopf}px`);
    stil.setProperty(ETB_FILTERLEISTE_HOEHE, `${gemessen.filterleiste}px`);
    stil.setProperty(ETB_SPALTENKOPF_HOEHE, `${gemessen.spaltenkopf}px`);
    setzeKopfSumme(gemessen.seitenkopf + gemessen.filterleiste + gemessen.spaltenkopf);
    return () => {
      // Das Wurzelelement überlebt die Route: ohne Aufräumen trüge jede folgende Seite den Abstand.
      stil.removeProperty(ETB_SEITENKOPF_HOEHE);
      stil.removeProperty(ETB_FILTERLEISTE_HOEHE);
      stil.removeProperty(ETB_SPALTENKOPF_HOEHE);
      setzeKopfSumme(0);
    };
  }, [klebt, gemessen]);

  return {
    klebt,
    seitenkopfRef: setSeitenkopf,
    filterleisteRef: setFilterleiste,
    zeitachseRef: setZeitachse,
  };
}
