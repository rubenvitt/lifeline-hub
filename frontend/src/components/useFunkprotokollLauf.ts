import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Bildlauf einer Liste in Funkprotokoll-Ordnung am DOKUMENT (LLH-1149, Spec
 * `etb-zeitachse-darstellung`, `openspec/changes/gonnp1g8-etb-ux-durchgang/design.md` D2): älteste
 * Zeile oben, neueste unten direkt über einer angepinnten Erfassung. Genutzt von ETB und
 * Informationstelefon, damit es nur eine Leserichtung gibt.
 *
 * Drei Aufgaben, alle ohne eigenen Bildlauf-Container (der bräche Rahmen, Bilanzspalte und
 * Fokusabstand):
 *
 * 1. **Öffnen am Ende.** Steht die Liste zum ersten Mal (`bereit`), rollt die Seite einmal ans
 *    Dokumentende — der jüngste Eintrag steht ohne Rollen über der Erfassung. Ein Sprungziel
 *    (`ohneStartlauf`) rollt selbst.
 * 2. **Mitlaufen an der jüngsten Zeile.** Stand die Seite am Ende, als eine neue jüngste Zeile
 *    kam, rollt sie mit — an der jüngsten Kennung, nicht an der Länge (`frontend/AGENTS.md`,
 *    „Stick-to-bottom“): „Ältere laden“ verlängert die Liste auch, darf aber nicht ans Ende
 *    reißen. Wer hochgerollt hat, bleibt stehen; die Liste zeigt dann ihr Sammelbanner.
 * 3. **Anker beim Nachladen oben.** Ändert sich die älteste Zeile (ältere Seite davor, oder die
 *    älteste Seite fällt aus dem Fenster), hält die zuletzt gesehene oberste Zeile ihren Platz am
 *    Schirm. Die Ankerung des Browsers ist dafür aus (`overflow-anchor: none` am Dokument, wie
 *    `stab/skizze/useAmSchirmHalten.ts`): Chromium und Firefox glichen sonst teilweise selbst aus,
 *    beide zusammen schöben doppelt, und WebKit kennt sie nicht.
 *
 * Gemessen wird nur in Effekten und im Bildlauf-Zuhörer, nie im Render.
 */

/**
 * Die Zeilen in Funkprotokoll-Ordnung: älteste oben, neueste unten direkt über der Erfassung.
 * Die Eingabe kommt in Serverordnung (neueste zuerst; im ETB die gepufferten am Kopf,
 * `etb/etbZeile.ts:baueZeilen`) und bleibt unberührt — Zähler, Druck, Sprung und Zufluss lesen
 * weiter die Serverordnung, nur die Darstellung kehrt sie um (design.md D1). Gepufferte stehen
 * danach ganz unten, abgelehnte zuletzt: dort, wo der Blick nach dem Erfassen ist.
 */
export function funkprotokollFolge<T>(zeilen: readonly T[]): T[] {
  return [...zeilen].reverse();
}

/** Wie nah am Dokumentende „am Ende“ gilt: eine Zeile Spiel für Rundung und Rand. */
export const AM_ENDE_SCHWELLE_PX = 48;

interface Anker {
  schluessel: string;
  oben: number;
}

interface Optionen {
  /** Wurzel der Zeilen; die Zeilen tragen `data-zeile` mit ihrem Schlüssel. */
  wurzel: RefObject<HTMLElement | null>;
  /** Die Liste steht (erste Lieferung oder Puffer) — erst dann rollt das Öffnen ans Ende. */
  bereit: boolean;
  /** Schlüssel der jüngsten gezeigten Zeile (unten). */
  juengste: string | undefined;
  /** Schlüssel der ältesten gezeigten Zeile (oben). */
  aelteste: string | undefined;
  /** Beim Öffnen nicht ans Ende rollen, etwa weil ein Sprungziel selbst rollt. */
  ohneStartlauf?: boolean;
}

function scroller(): HTMLElement {
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Steht das Fenster am Dokumentende? Ohne Überlauf immer. */
export function istAmEnde(): boolean {
  const el = scroller();
  return el.scrollHeight - (window.scrollY + window.innerHeight) <= AM_ENDE_SCHWELLE_PX;
}

function rolleAnsEnde() {
  window.scrollTo?.({ top: scroller().scrollHeight, behavior: 'instant' });
}

/** Die erste Zeile, deren Unterkante im Fenster liegt — die Lesestelle oben. */
function obersteSichtbare(wurzel: HTMLElement | null): Anker | null {
  if (!wurzel) return null;
  for (const el of wurzel.querySelectorAll<HTMLElement>('[data-zeile]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > 0) return { schluessel: el.dataset.zeile ?? '', oben: r.top };
  }
  return null;
}

export function useFunkprotokollLauf({
  wurzel,
  bereit,
  juengste,
  aelteste,
  ohneStartlauf = false,
}: Optionen): { amEnde: boolean; zumEnde: () => void } {
  const [amEnde, setAmEnde] = useState(true);
  const amEndeRef = useRef(true);
  const anker = useRef<Anker | null>(null);
  const gestartet = useRef(false);

  const merke = useCallback(() => {
    const jetzt = istAmEnde();
    amEndeRef.current = jetzt;
    setAmEnde(jetzt);
    anker.current = obersteSichtbare(wurzel.current);
  }, [wurzel]);

  const zumEnde = useCallback(() => {
    rolleAnsEnde();
    amEndeRef.current = true;
    setAmEnde(true);
  }, []);

  // Eigene Ankerung statt der des Browsers (Dateikopf, Punkt 3).
  useEffect(() => {
    const wurzeln = [document.documentElement, document.body];
    const vorher = wurzeln.map((w) => w.style.overflowAnchor);
    for (const w of wurzeln) w.style.overflowAnchor = 'none';
    let rahmen = 0;
    const beiBildlauf = () => {
      if (rahmen) return;
      rahmen = requestAnimationFrame(() => {
        rahmen = 0;
        merke();
      });
    };
    window.addEventListener('scroll', beiBildlauf, { passive: true });
    window.addEventListener('resize', beiBildlauf, { passive: true });
    return () => {
      window.removeEventListener('scroll', beiBildlauf);
      window.removeEventListener('resize', beiBildlauf);
      if (rahmen) cancelAnimationFrame(rahmen);
      wurzeln.forEach((w, i) => (w.style.overflowAnchor = vorher[i]));
    };
  }, [merke]);

  /*
   * Ein Effekt für alle drei Fälle, nach jeder Änderung der Ränder. Am Ende merkt er die neue
   * Lesestelle: die nächste Änderung braucht den Anker VOR sich, und ein Bildlauf-Ereignis kommt
   * nicht, wenn sich nur der Inhalt ändert.
   */
  const vorige = useRef({ juengste, aelteste });
  useLayoutEffect(() => {
    if (!bereit) return;
    const neueJuengste = vorige.current.juengste !== juengste;
    const neueAelteste = vorige.current.aelteste !== aelteste;
    vorige.current = { juengste, aelteste };
    let rahmen = 0;
    if (!gestartet.current) {
      // 1. Öffnen am Ende — einmal. Ein zweiter Rahmen fängt Gruppen, deren Höhe der Browser erst
      // beim Auslegen kennt (`content-visibility: auto` schätzt sie vorher).
      gestartet.current = true;
      if (!ohneStartlauf) {
        zumEnde();
        rahmen = requestAnimationFrame(() => {
          if (amEndeRef.current) rolleAnsEnde();
        });
      } else {
        amEndeRef.current = istAmEnde();
        setAmEnde(amEndeRef.current);
      }
    } else if (amEndeRef.current && (neueJuengste || neueAelteste)) {
      // 2. Mitlaufen: stand die Seite am Ende, folgt sie der neuen jüngsten Zeile.
      rolleAnsEnde();
    } else if (neueAelteste && anker.current) {
      // 3. Anker: die Lesestelle bleibt am Schirm.
      const a = anker.current;
      const el = [...(wurzel.current?.querySelectorAll<HTMLElement>('[data-zeile]') ?? [])].find(
        (z) => z.dataset.zeile === a.schluessel,
      );
      const versatz = el ? el.getBoundingClientRect().top - a.oben : 0;
      if (versatz !== 0) window.scrollBy?.({ top: versatz, behavior: 'instant' });
    }
    anker.current = obersteSichtbare(wurzel.current);
    return () => cancelAnimationFrame(rahmen);
  }, [bereit, juengste, aelteste, ohneStartlauf, wurzel, zumEnde]);

  return { amEnde, zumEnde };
}
