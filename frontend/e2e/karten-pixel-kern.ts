import type { Page } from '@playwright/test';

/**
 * Pixel-Messkern für Konturen auf der Kartenleinwand, geteilt von allen Specs, die einen Kreis
 * gegen den Kartengrund messen (`betroffene-kontrast.spec.ts`, `fachebenen-kontrast.spec.ts`).
 * Die Leinwand hat kein DOM, `kontrast-kern.ts` greift dort nicht; eine Kopie je Spec driftete
 * still auseinander (Kopf von `kontrast-kern.ts`).
 *
 * Gemessen wird ein 64-px-Ausschnitt um die Kreismitte, im Browser dekodiert. Längs eines Strahls
 * nach rechts liegen innen der helle Rand und außen die dunkle Kante; der Grund wird diagonal weit
 * außerhalb gelesen. Die Kontur hält, wenn EINE der beiden Linien ≥ 3 : 1 gegen den Grund steht —
 * sie liegen nebeneinander, das Auge braucht nur eine.
 */

/** Abstände in px von der Kreismitte, jeweils einschließlich. */
export interface KantenStrahl {
  /** Heller Rand: gemessen wird das HELLSTE Pixel im Bereich. */
  rand: [number, number];
  /** Dunkle Kante: gemessen wird das DUNKELSTE Pixel im Bereich. */
  kante: [number, number];
  /** Abstand eines Pixels der Füllung; ohne Angabe keine Füllungsmessung. */
  fuellung?: number;
}

export interface KantenMessung {
  rand: number;
  kante: number;
  beste: number;
  /** Füllung gegen Grund — ein Messwert für die Prüfliste, keine Schwelle. */
  fuellung: number | null;
  /** Der gelesene Grund als `rgb(…)`, damit die Anmerkung sagt, wogegen gemessen wurde. */
  grund: string;
}

/** Seitenkoordinaten (gerundet) eines Kartenpunkts über den Testhaken `window.__lfhKarte`. */
export function kartenpunktAufSeite(page: Page, ll: readonly [number, number]) {
  return page.evaluate((ziel) => {
    const k = (
      window as unknown as {
        __lfhKarte: {
          project(ll: [number, number]): { x: number; y: number };
          getCanvas(): HTMLCanvasElement;
        };
      }
    ).__lfhKarte;
    const p = k.project([ziel[0], ziel[1]]);
    const r = k.getCanvas().getBoundingClientRect();
    return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
  }, ll);
}

/** Misst Rand, Kante und Füllung eines Kreises um `mitte` (Seitenkoordinaten) gegen den Grund. */
export async function messeKante(
  page: Page,
  mitte: { x: number; y: number },
  strahl: KantenStrahl,
): Promise<KantenMessung> {
  const png = await page.screenshot({
    clip: { x: mitte.x - 32, y: mitte.y - 32, width: 64, height: 64 },
  });
  return page.evaluate(
    async ([b64, s]) => {
      const bild = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${b64}`)).blob(),
      );
      const c = document.createElement('canvas');
      c.width = bild.width;
      c.height = bild.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bild, 0, 0);
      const px = (x: number, y: number) =>
        Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
      const lum = ([r, g, b]: number[]) => {
        const l = [r, g, b].map((n) => {
          const t = n / 255;
          return t <= 0.04045 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4;
        });
        return l[0] * 0.2126 + l[1] * 0.7152 + l[2] * 0.0722;
      };
      const k = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const grundPx = px(32 + 26, 32 + 26);
      const grund = lum(grundPx);
      const bereich = ([von, bis]: [number, number]) =>
        Array.from({ length: bis - von + 1 }, (_, i) => lum(px(32 + von + i, 32)));
      const rand = k(Math.max(...bereich(s.rand)), grund);
      const kante = k(Math.min(...bereich(s.kante)), grund);
      return {
        rand,
        kante,
        beste: Math.max(rand, kante),
        fuellung: s.fuellung === undefined ? null : k(lum(px(32 + s.fuellung, 32)), grund),
        grund: `rgb(${grundPx.join(', ')})`,
      };
    },
    [png.toString('base64'), strahl] as const,
  );
}
