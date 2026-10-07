/**
 * Virtualisierung über den BILDLAUF DER SEITE (LFH-949, Entscheidung Ruben 07.10.2026). Große Listen
 * rendern nur ihren Sichtbereich plus einen Überhang; Platzhalter oben und unten tragen die Höhe der
 * übrigen, damit die Bildlaufleiste der Seite ehrlich bleibt.
 *
 * Gerechnet wird gegen `window`, nicht gegen einen eigenen Container: stehende Kopfzeile
 * (`useRahmenOben`), Überlauf-Gates und das Tablet ohne Bildlauf im Bildlauf bleiben, wie sie sind.
 * Das schließt antds `virtual` aus (braucht `scroll.y`). Keine Bibliothek: die Rechnung ist eine
 * Präfixsumme, die Tabelle braucht ihre Platzhalterzeilen ohnehin selbst.
 *
 * Höhen werden GEMESSEN, über die Abstände der gerenderten Einträge zueinander; so zählen
 * Aufklappbereich und Baumkinder zu ihrem Eintrag. Ungemessene Einträge schätzt das Mittel der
 * gemessenen. Eine Messung von 0 (jsdom, verborgen) gilt als nicht gemessen.
 *
 * Herleitung: `/mnt/project-files/lfh-949/design.md`, D1–D3.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Key,
  type RefObject,
} from 'react';

/** Wie weit über und unter dem Sichtbereich noch gerendert wird (px). */
export const AUSSCHNITT_UEBERHANG = 800;

/** Attribut am Element jedes gerenderten Eintrags; trägt dessen Schlüssel. */
export const FENSTER_EINTRAG = 'data-fenster-eintrag';
/** Attribut am Platzhalter hinter dem letzten gerenderten Eintrag (Messende). */
export const FENSTER_ENDE = 'data-fenster-ende';

export interface AusschnittEingabe {
  /** Gemessene Höhe je Eintrag in Folge; `undefined` oder 0 = nicht gemessen. */
  hoehen: readonly (number | undefined)[];
  schaetzung: number;
  /** Sichtbereich relativ zum Anfang des ersten Eintrags (px). */
  sichtVon: number;
  sichtBis: number;
  ueberhang: number;
  /** Index eines Eintrags, der im Ausschnitt stehen MUSS (Deeplink); sonst `null`. */
  anker: number | null;
}

export interface Ausschnitt {
  /** Erster gerenderter Index. */
  von: number;
  /** Erster NICHT mehr gerenderter Index. */
  bis: number;
  /** Höhe des Platzhalters oben bzw. unten (px). */
  oben: number;
  unten: number;
  gesamt: number;
}

export function berechneAusschnitt(e: AusschnittEingabe): Ausschnitt {
  const n = e.hoehen.length;
  if (n === 0) return { von: 0, bis: 0, oben: 0, unten: 0, gesamt: 0 };
  const hoehe = (i: number) => {
    const h = e.hoehen[i];
    return h != null && h > 0 ? h : e.schaetzung;
  };
  // Präfixsumme: anfang[i] = Oberkante von Eintrag i, anfang[n] = Gesamthöhe.
  const anfang = new Array<number>(n + 1);
  anfang[0] = 0;
  for (let i = 0; i < n; i++) anfang[i + 1] = anfang[i] + hoehe(i);
  const gesamt = anfang[n];

  const spanne = Math.max(0, e.sichtBis - e.sichtVon);
  let sichtVon = e.sichtVon;
  if (e.anker != null && e.anker >= 0 && e.anker < n) {
    const mitte = anfang[e.anker] + hoehe(e.anker) / 2;
    const innen = anfang[e.anker] >= e.sichtVon - e.ueberhang && mitte <= e.sichtBis + e.ueberhang;
    // Ein Anker außerhalb zentriert den Ausschnitt auf sich, statt ihn bis zu sich zu dehnen.
    if (!innen) sichtVon = mitte - spanne / 2;
  }
  // Hinter dem Ende (Liste geschrumpft): die letzten Einträge bleiben stehen.
  sichtVon = Math.min(sichtVon, Math.max(0, gesamt - spanne));
  const unterkante = sichtVon - e.ueberhang;
  const oberkante = sichtVon + spanne + e.ueberhang;

  let von = 0;
  while (von < n - 1 && anfang[von + 1] <= unterkante) von++;
  let bis = von + 1;
  while (bis < n && anfang[bis] < oberkante) bis++;
  return { von, bis, oben: anfang[von], unten: gesamt - anfang[bis], gesamt };
}

interface FensterArgs {
  /** Schlüssel aller Einträge in Folge. */
  schluessel: readonly Key[];
  /** Unter der Schwelle `false`: dann rendert alles, ohne Messung und Zuhörer. */
  aktiv: boolean;
  /** Startschätzung, bis etwas gemessen ist. */
  schaetzung: number;
  /** Element, an dem der erste Eintrag beginnt (oberer Platzhalter). */
  start: RefObject<HTMLElement | null>;
  /** Wurzel, in der die Einträge gesucht werden. */
  wurzel: RefObject<HTMLElement | null>;
  /** Schlüssel des Eintrags, der gerendert und gezeigt werden muss (Deeplink). */
  anker?: Key | null;
  ueberhang?: number;
}

/**
 * Der Hook zum Rechenteil. Liefert den Ausschnitt; der Aufrufer rendert `schluessel.slice(von, bis)`,
 * setzt {@link FENSTER_EINTRAG} an jeden Eintrag, {@link FENSTER_ENDE} an den unteren Platzhalter und
 * hängt `start` an den oberen.
 */
export function useFensterAusschnitt({
  schluessel,
  aktiv,
  schaetzung,
  start,
  wurzel,
  anker = null,
  ueberhang = AUSSCHNITT_UEBERHANG,
}: FensterArgs): Ausschnitt {
  const hoehen = useRef(new Map<Key, number>());
  const [sicht, setSicht] = useState(() => ({ von: 0, bis: fensterHoehe() }));
  // Version der Messung: steigt, wenn eine Messung eine Höhe ändert, und rendert dann neu.
  const [, setMessung] = useState(0);
  // Der Anker gilt, bis jemand rollt: nach `scrollIntoView` steht die Sicht ohnehin um ihn herum.
  // Schon im ersten Render gesetzt, damit ein `scrolleZurZeile` des Verwenders die Zeile findet.
  const [aktiverAnker, setAktiverAnker] = useState<Key | null>(anker);
  useEffect(() => {
    setAktiverAnker(anker);
  }, [anker]);

  const schaetzwert = mittel(hoehen.current) ?? schaetzung;
  const ankerIndex = aktiverAnker == null ? -1 : schluessel.indexOf(aktiverAnker);
  const ausschnitt = aktiv
    ? berechneAusschnitt({
        hoehen: schluessel.map((k) => hoehen.current.get(k)),
        schaetzung: schaetzwert,
        sichtVon: sicht.von,
        sichtBis: sicht.bis,
        ueberhang,
        anker: ankerIndex >= 0 ? ankerIndex : null,
      })
    : { von: 0, bis: schluessel.length, oben: 0, unten: 0, gesamt: 0 };

  const leseSicht = useCallback(() => {
    const oben = start.current?.getBoundingClientRect().top ?? 0;
    return { von: -oben, bis: fensterHoehe() - oben };
  }, [start]);

  // Bildlauf und Größe: höchstens einmal je Bild, und nur ein Render, wenn sich die Sicht bewegt.
  useEffect(() => {
    if (!aktiv) return;
    let bild = 0;
    const lauf = () => {
      if (bild) return;
      bild = requestAnimationFrame(() => {
        bild = 0;
        setAktiverAnker(null);
        setSicht(leseSicht());
      });
    };
    setSicht(leseSicht());
    window.addEventListener('scroll', lauf, { passive: true });
    window.addEventListener('resize', lauf);
    return () => {
      window.removeEventListener('scroll', lauf);
      window.removeEventListener('resize', lauf);
      if (bild) cancelAnimationFrame(bild);
    };
  }, [aktiv, leseSicht]);

  // Messen nach jedem Render: Abstand von Eintrag zu Eintrag, der letzte bis zum Messende.
  useLayoutEffect(() => {
    if (!aktiv || !wurzel.current) return;
    const eintraege = Array.from(
      wurzel.current.querySelectorAll<HTMLElement>(`[${FENSTER_EINTRAG}]`),
    );
    const ende = wurzel.current.querySelector<HTMLElement>(`[${FENSTER_ENDE}]`);
    let geaendert = false;
    eintraege.forEach((el, i) => {
      const k = el.getAttribute(FENSTER_EINTRAG);
      if (k == null) return;
      const naechstes = eintraege[i + 1] ?? ende;
      if (!naechstes) return;
      const h = naechstes.getBoundingClientRect().top - el.getBoundingClientRect().top;
      if (!(h > 0)) return;
      const schluesselEcht = schluesselZu(k, schluessel);
      const alt = hoehen.current.get(schluesselEcht);
      if (alt == null || Math.abs(alt - h) > 1) {
        hoehen.current.set(schluesselEcht, h);
        geaendert = true;
      }
    });
    if (geaendert) setMessung((v) => v + 1);
  });

  // Der Deeplink steht jetzt im DOM: ins Bild damit (jsdom kennt `scrollIntoView` nicht).
  useLayoutEffect(() => {
    if (!aktiv || aktiverAnker == null || !wurzel.current) return;
    const el = wurzel.current.querySelector<HTMLElement>(
      `[${FENSTER_EINTRAG}="${CSS.escape(String(aktiverAnker))}"]`,
    );
    el?.scrollIntoView?.({ block: 'center' });
  }, [aktiv, aktiverAnker, wurzel]);

  return ausschnitt;
}

function fensterHoehe(): number {
  return typeof window === 'undefined' ? 0 : window.innerHeight;
}

function mittel(werte: ReadonlyMap<Key, number>): number | null {
  if (werte.size === 0) return null;
  let summe = 0;
  for (const w of werte.values()) summe += w;
  return summe / werte.size;
}

/** Das Attribut ist ein String; numerische Schlüssel kommen als Zahl zurück. */
function schluesselZu(text: string, schluessel: readonly Key[]): Key {
  const zahl = Number(text);
  return text !== '' && Number.isFinite(zahl) && schluessel.includes(zahl) ? zahl : text;
}
