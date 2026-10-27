import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * Untere Leisten und was ihnen ausweicht (LLH-1424, Spec `benachrichtigungen`, „Das Eingangsband
 * verdeckt keine untere Leiste“).
 *
 * Seiten mit einer am Fuß angepinnten Leiste (ETB-Erfassung, Aktionsleiste des Befehlsentwurfs,
 * Speicherleiste der Formularseiten, Tastenfeld der Ausgabe …) melden sie hier an; wer frei über
 * dem unteren Rand liegt, das Eingangsband (`alarm/Eingangsband.tsx`), rückt über sie. Gemeldet
 * wird nicht je Seite, sondern einmal in der gemeinsamen Messung `beobachteFussleiste`
 * (`components/fokusabstandUnten.ts`): jede Leiste, die ihren Fokusabstand misst, ist damit
 * angeschlossen, eine neue braucht keine zweite Zeile.
 *
 * **Gemessen wird die LAGE der Leiste, nicht nur ihre Höhe.** `sticky; bottom: 0` klebt nur, wenn
 * die Seite höher als das Fenster ist; auf einem leeren ETB stand die Erfassung gemessen bei
 * 501 px eines 900-px-Fensters, und ein nur um die Leistenhöhe gerücktes Band lag halb über ihr.
 * Deshalb liest das Band die Kästen der Leisten und rückt nur, wenn es eine schneiden würde, dann
 * über deren Oberkante. Liegt eine Leiste höher als das Band, bleibt es am Rand.
 */

const leisten = new Set<HTMLElement>();
const hoerer = new Set<() => void>();
let schnappschuss: readonly HTMLElement[] = [];

function verteile() {
  schnappschuss = [...leisten];
  for (const h of hoerer) h();
}

/** Meldet eine untere Leiste an; der Schlüssel ist das Element selbst. */
export function meldeUntereLeiste(leiste: HTMLElement) {
  if (leisten.has(leiste)) return;
  leisten.add(leiste);
  verteile();
}

/** Nimmt die Meldung einer Leiste zurück (Aushängen). */
export function entferneUntereLeiste(leiste: HTMLElement) {
  if (!leisten.delete(leiste)) return;
  verteile();
}

/** Die angemeldeten Leisten; ein stabiles Feld, das nur bei einer Änderung neu entsteht. */
export function untereLeisten(): readonly HTMLElement[] {
  return schnappschuss;
}

function abonnieren(h: () => void) {
  hoerer.add(h);
  return () => {
    hoerer.delete(h);
  };
}

export function useUntereLeisten() {
  return useSyncExternalStore(abonnieren, untereLeisten, untereLeisten);
}

/** Was {@link bandAbstand} von einem Kasten braucht; `DOMRect` erfüllt es. */
export type Kasten = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>;

/**
 * Abstand des Bands vom unteren Fensterrand (px), rein und exportiert.
 *
 * Beginnt am `rand` und rückt, solange das Band an dieser Stelle eine Leiste schnitte, über deren
 * Oberkante (plus `rand`). Mehrere Leisten werden von unten nach oben abgearbeitet, damit das
 * Band nach dem Rücken nicht in der nächsten landet. Eine Leiste ohne Fläche zählt nicht.
 */
export function bandAbstand({
  fenster,
  rand,
  band,
  leisten,
}: {
  /** Höhe des Fensters, auf das sich `position: fixed` bezieht. */
  fenster: number;
  rand: number;
  /** Höhe und waagerechte Lage des Bands. */
  band: { hoehe: number; left: number; right: number };
  leisten: readonly Kasten[];
}): number {
  let abstand = rand;
  const sortiert = leisten
    .filter((l) => l.bottom > l.top && l.right > l.left)
    .sort((a, b) => b.bottom - a.bottom);
  for (const l of sortiert) {
    const unten = fenster - abstand;
    const oben = unten - band.hoehe;
    const schneidet =
      l.top < unten && l.bottom > oben && l.left < band.right && l.right > band.left;
    if (schneidet) abstand = Math.max(abstand, fenster - l.top + rand);
  }
  return abstand;
}

/**
 * Hook des Bands: misst Band und angemeldete Leisten und liefert {@link bandAbstand}. Neu
 * gerechnet bei Rollen (auch in inneren Rollbereichen), Fenstergröße, Größenänderung von Band, Leisten oder Seite (die Lage einer
 * Leiste ändert sich, wenn Inhalt darüber wächst), höchstens einmal je Bild.
 */
export function useBandAbstand(band: RefObject<HTMLElement | null>, rand: number) {
  const angemeldet = useUntereLeisten();
  const [abstand, setAbstand] = useState(rand);

  useEffect(() => {
    const el = band.current;
    if (!el) return undefined;
    let bild = 0;
    const rechne = () => {
      bild = 0;
      const b = el.getBoundingClientRect();
      setAbstand(
        bandAbstand({
          fenster: document.documentElement.clientHeight,
          rand,
          band: { hoehe: b.height, left: b.left, right: b.right },
          leisten: angemeldet.map((l) => l.getBoundingClientRect()),
        }),
      );
    };
    const vormerken = () => {
      if (bild === 0) bild = requestAnimationFrame(rechne);
    };
    rechne();
    if (angemeldet.length === 0) return undefined;
    const beobachter = new ResizeObserver(vormerken);
    beobachter.observe(el);
    beobachter.observe(document.body);
    for (const l of angemeldet) beobachter.observe(l);
    // Im Einfangen: auch ein innerer Rollbereich (Inhalt des Rahmens) verschiebt eine Leiste.
    document.addEventListener('scroll', vormerken, { capture: true, passive: true });
    window.addEventListener('resize', vormerken);
    return () => {
      if (bild !== 0) cancelAnimationFrame(bild);
      beobachter.disconnect();
      document.removeEventListener('scroll', vormerken, { capture: true });
      window.removeEventListener('resize', vormerken);
    };
  }, [band, rand, angemeldet]);

  return abstand;
}
