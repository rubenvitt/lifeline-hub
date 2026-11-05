import { useEffect, useState } from 'react';

/**
 * Wann die Kurzzeile der Ausgabeansicht steht (LLH-1504).
 *
 * Am Handy in `komfortabel` ist die Ansicht höher als der Schirm, und das Kennzahlenband im Kopf
 * steht zweizeilig (rund 175 px bei 390 px). Wer zu einer Sonderkost-Taste rollt, verlöre Soll,
 * ausgegeben und fehlt aus dem Blick; den ganzen Kopf kleben zu lassen kostete mit dem Tastenfeld
 * mehr als die Hälfte des Schirms. Stattdessen klebt oben ein Anker ohne Höhe (erstes Kind der
 * Ansicht), und an ihm erscheint eine einzeilige Kurzzeile, sobald das Band unter die Kante rollt.
 * Sie liegt über dem Inhalt, nimmt keinen Platz und verschiebt keine Taste.
 *
 * Vorher steht der Anker über dem Band (er ist das erste Kind, das Band folgt nach der Zeile mit
 * der Einstufung); erst wenn er klebt und das Band weiter hinaufrollt, liegt dessen Oberkante über
 * der des Ankers. Rein; gemessen in `useKurzzeile`.
 */
export function kurzzeileSichtbar(band: { top: number }, anker: { top: number }): boolean {
  // Halbe Pixel sind Rundung: beim Einrasten stehen beide Kanten sonst einen Bruchteil versetzt.
  return band.top < anker.top - 0.5;
}

/**
 * Callback-Refs für Anker und Band und der Stand `sichtbar`. Gemessen beim Rollen (jeder
 * Scrollbereich: am Stab das Dokument, am Gerät das `main`, deshalb `capture` am Dokument), bei
 * Fenster- und Bandgröße, im nächsten Bild.
 */
export function useKurzzeile() {
  const [anker, setAnker] = useState<HTMLElement | null>(null);
  const [band, setBand] = useState<HTMLElement | null>(null);
  const [sichtbar, setSichtbar] = useState(false);
  useEffect(() => {
    if (!anker || !band) return undefined;
    let bild: number | undefined;
    const messen = () => {
      bild = undefined;
      setSichtbar(kurzzeileSichtbar(band.getBoundingClientRect(), anker.getBoundingClientRect()));
    };
    const planen = () => {
      if (bild == null) bild = requestAnimationFrame(messen);
    };
    messen();
    const optionen = { capture: true, passive: true } as const;
    document.addEventListener('scroll', planen, optionen);
    window.addEventListener('resize', planen);
    const beobachter = new ResizeObserver(planen);
    beobachter.observe(band);
    return () => {
      document.removeEventListener('scroll', planen, optionen);
      window.removeEventListener('resize', planen);
      beobachter.disconnect();
      if (bild != null) cancelAnimationFrame(bild);
    };
  }, [anker, band]);
  return { ankerRef: setAnker, bandRef: setBand, sichtbar };
}
