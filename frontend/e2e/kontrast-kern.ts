import { expect, type Locator } from '@playwright/test';

/**
 * Messkern für Text-/Hintergrundkontrast — geteiltes e2e-Modul.
 *
 * WARUM EIGENES MODUL: der Kern entstand in `betroffene-kontrast.spec.ts` (LFH-455) und wird
 * seit LFH-618 auch von `hellmodus-kontrast.spec.ts` gebraucht. Eine Kopie driftet still
 * auseinander, und ein Messkern, der an zwei Orten verschieden rechnet, macht beide
 * Nachweise wertlos (Präzedenz: `fokus-kern.ts`).
 *
 * Der Inhalt ist ein REINER MOVE aus der Bestandsdatei; deren Selbstprobe („komponiert
 * Alpha und erkennt unlesbare Schrift") bleibt dort und belegt weiterhin denselben Kern.
 */

// LFH-455: echte Text-/Hintergrundpaare inklusive transparenter Vorfahren.
// Keine Farbwerte aus dem Produkt importieren: eine schlechte Palette muss rot werden.
export async function kontrast(tag: Locator) {
  return tag.evaluate((element) => {
    type Farbe = [number, number, number, number];
    function rgb(wert: string): Farbe {
      const m = /^rgba?\(([^)]+)\)$/.exec(wert);
      if (!m) throw new Error(`Nicht unterstützte Farbe: ${wert}`);
      const teile = m[1].split(/[\s,/]+/).map(Number);
      if (teile.length < 3 || teile.some((n) => !Number.isFinite(n))) throw new Error(wert);
      return [teile[0], teile[1], teile[2], teile[3] ?? 1];
    }
    function darueber(vorne: Farbe, hinten: Farbe): Farbe {
      const a = vorne[3] + hinten[3] * (1 - vorne[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2]
        .map((i) => (vorne[i] * vorne[3] + hinten[i] * hinten[3] * (1 - vorne[3])) / a)
        .concat(a) as Farbe;
    }
    function luminanz(f: Farbe) {
      const linear = f.slice(0, 3).map((n) => {
        const s = n / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    const vorfahren: Element[] = [];
    for (let e: Element | null = element; e; e = e.parentElement) vorfahren.push(e);
    let grund: Farbe = [0, 0, 0, 0];
    for (const e of vorfahren.reverse()) {
      const stil = getComputedStyle(e);
      if (
        stil.backgroundImage !== 'none' ||
        Number(stil.opacity) !== 1 ||
        stil.mixBlendMode !== 'normal'
      ) {
        throw new Error(
          `Nicht unterstützte Komposition an ${e.tagName}.${e.className}: ${stil.backgroundImage}, opacity=${stil.opacity}, blend=${stil.mixBlendMode}`,
        );
      }
      grund = darueber(rgb(stil.backgroundColor), grund);
    }
    if (grund[3] !== 1) throw new Error('Kein opaker Hintergrund belegt');
    const text = darueber(rgb(getComputedStyle(element).color), grund);
    const [a, b] = [luminanz(text), luminanz(grund)].sort((x, y) => x - y);
    return { text, grund, verhaeltnis: (b + 0.05) / (a + 0.05) };
  });
}

export async function pruefe(tag: Locator, minimum: number, name: string) {
  await expect(tag, name).toBeVisible();
  // Modal-Einblendung erst abwarten: Opacity-Gruppen liefern keine belastbare Messung.
  // Ein dauerhaft nicht unterstützter Stil bleibt ein Fehler, statt still zu bestehen.
  await expect(async () => {
    const messung = await kontrast(tag);
    expect(messung.verhaeltnis, `${name}: ${JSON.stringify(messung)}`).toBeGreaterThanOrEqual(
      minimum,
    );
  }).toPass({ timeout: 10_000 });
}
