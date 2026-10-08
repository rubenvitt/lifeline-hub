import { useLayoutEffect, type RefObject } from 'react';

/**
 * Ruhige Fläche, Teil Schirm (LFH-1037 D2): Solange `halten` gilt, bleibt `ziel` am Schirm stehen,
 * auch wenn darüber etwas wächst oder schrumpft (Lücken-Paneel, Quellenzeilen).
 *
 * Je Bild (`requestAnimationFrame`, vor dem Zeichnen) misst der Haken den Abstand des Ziels zum
 * Dokumentanfang. Ändert er sich, ist darüber etwas umgebrochen, und das Fenster scrollt das Ziel
 * zurück an seinen Ort am Schirm. Ein Bildlauf der Person ändert diesen Abstand nicht; er setzt
 * nur den Ort neu, an dem das Ziel steht. Der Bildlauf rastet auf ganze Pixel, deshalb zielt jeder
 * Ausgleich auf diesen Ort, nicht auf die Differenz: so bleibt höchstens ein halber Pixel, und
 * Reste summieren sich nicht.
 *
 * Die Ankerung des Browsers (`overflow-anchor`) ist beim Halten aus: sie gliche in Chromium und
 * Firefox teilweise schon selbst aus, und beide zusammen schöben doppelt. WebKit kennt sie nicht;
 * so verhalten sich alle drei Engines gleich.
 */
export function useAmSchirmHalten(ziel: RefObject<Element | null>, halten: boolean) {
  useLayoutEffect(() => {
    if (!halten) return;
    const wurzeln = [document.documentElement, document.body];
    const vorher = wurzeln.map((w) => w.style.overflowAnchor);
    for (const w of wurzeln) w.style.overflowAnchor = 'none';
    /** Abstand des Ziels zum Dokumentanfang beim letzten Bild. */
    let abstand: number | null = null;
    /** Wo das Ziel am Schirm steht (Oberkante im Fenster). */
    let oben = 0;
    /** Bildlauf nach dem letzten Bild: weicht er ab, hat die Person gescrollt. */
    let y = window.scrollY;
    let rahmen = 0;
    const pruefe = () => {
      const el = ziel.current;
      if (el) {
        const r = el.getBoundingClientRect().top;
        const jetzt = r + window.scrollY;
        if (abstand == null || window.scrollY !== y) oben = r;
        else if (jetzt !== abstand) window.scrollTo(window.scrollX, jetzt - oben);
        abstand = jetzt;
        y = window.scrollY;
      }
      rahmen = requestAnimationFrame(pruefe);
    };
    pruefe();
    return () => {
      cancelAnimationFrame(rahmen);
      wurzeln.forEach((w, i) => (w.style.overflowAnchor = vorher[i]));
    };
  }, [ziel, halten]);
}
