import { useEffect, useState, type RefObject } from 'react';
import { useUntereLeisten, type Kasten } from '../../components/untereLeiste';

/** Das Livebild bleibt mindestens so hoch (px), sonst ist es kein Bild mehr (LLH-2137). */
export const LIVEBILD_MIN_HOEHE = 72;

/** Seitenverhältnis des Livebilds (Breite : Höhe), wie die Fläche im Fenster. */
const SEITENVERHAELTNIS = 16 / 9;

/**
 * Größte Breite des Livebild-Fensters (px), bei der es über dem Kartenfuß endet — rein und
 * exportiert (LLH-2137).
 *
 * Das Fenster steht im linken Block unter der Zeigerkoordinate. Seine Unterkante darf bis
 * `rand` über das oberste Band des Fußes reichen, das unter seiner Oberkante beginnt und es
 * waagerecht schneidet, ohne Fuß bis `rand` über den unteren Kartenrand. Leisten über der
 * Oberkante (das Werkzeugmenü steht oben im Fuß-Rahmen) und Leisten ohne Fläche zählen nicht.
 *
 * Die Bildfläche behält 16 : 9: aus der freien Höhe folgt die Breite des Bilds, dazu kommt, was
 * das Fenster um das Bild trägt (Kopf, Rahmen). Unter {@link LIVEBILD_MIN_HOEHE} schrumpft es nicht.
 */
export function livebildMaxBreite({
  fenster,
  video,
  kartenUnten,
  leisten,
  rand,
}: {
  fenster: Kasten & { width: number; height: number };
  /** Kasten der Bildfläche im Fenster (16 : 9). */
  video: { width: number; height: number };
  /** Unterkante der Karte im selben Koordinatensystem wie die Kästen. */
  kartenUnten: number;
  leisten: readonly Kasten[];
  rand: number;
}): number {
  const grenze = leisten
    .filter(
      (l) =>
        l.bottom > l.top &&
        l.right > l.left &&
        l.top > fenster.top &&
        l.left < fenster.right &&
        l.right > fenster.left,
    )
    .reduce((g, l) => Math.min(g, l.top - rand), kartenUnten - rand);
  const umBild = fenster.height - video.height;
  const hoehe = Math.max(LIVEBILD_MIN_HOEHE, grenze - fenster.top - umBild);
  return fenster.width - video.width + hoehe * SEITENVERHAELTNIS;
}

/**
 * Misst Fenster, Bildfläche, Karte und die Bänder des Kartenfußes und liefert
 * {@link livebildMaxBreite}; `null`, solange nichts gemessen ist (LLH-2137). Neu gerechnet, wenn
 * Karte, linker Block oder ein Band die Größe ändert und wenn Bänder kommen oder gehen, höchstens
 * einmal je Bild. Das Fenster selbst wird nicht beobachtet: es ändert sich durch das Ergebnis.
 */
export function useLivebildMaxBreite(
  fenster: RefObject<HTMLElement | null>,
  bild: RefObject<HTMLElement | null>,
  rand: number,
): number | null {
  const leisten = useUntereLeisten();
  const [breite, setBreite] = useState<number | null>(null);
  useEffect(() => {
    const f = fenster.current;
    const b = bild.current;
    const block = f?.parentElement;
    const karte = block?.offsetParent;
    if (!f || !b || !block || !(karte instanceof HTMLElement)) return undefined;
    let takt = 0;
    const rechne = () => {
      cancelAnimationFrame(takt);
      takt = requestAnimationFrame(() => {
        const neu = livebildMaxBreite({
          fenster: f.getBoundingClientRect(),
          video: b.getBoundingClientRect(),
          kartenUnten: karte.getBoundingClientRect().bottom,
          leisten: leisten.map((l) => l.getBoundingClientRect()),
          rand,
        });
        setBreite((alt) => (alt != null && Math.abs(alt - neu) < 0.5 ? alt : neu));
      });
    };
    const beobachter = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(rechne);
    for (const el of [karte, block, ...leisten]) beobachter?.observe(el);
    rechne();
    return () => {
      beobachter?.disconnect();
      cancelAnimationFrame(takt);
    };
  }, [fenster, bild, leisten, rand]);
  return breite;
}
