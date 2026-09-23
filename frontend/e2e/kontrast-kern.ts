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
 *
 * Seit LFH-646 misst derselbe Kern auch eine RANDFARBE ({@link randKontrast}). Dafür ist die
 * Rechnung in EINE Seitenfunktion gezogen, die Vordergrund-Eigenschaft und Grundfläche als
 * Auftrag bekommt — `kontrast()` ruft sie mit `color` gegen die eigene Fläche und liefert
 * dieselben Werte wie vorher. Eine zweite Kopie der Kompositionsrechnung für den Rand wäre
 * genau die Drift, gegen die dieses Modul existiert.
 */

type Farbe = [number, number, number, number];

interface Auftrag {
  /** CSS-Eigenschaft des Vordergrunds, z. B. `color` oder `border-left-color`. */
  vordergrund: string;
  /** Grundfläche: die komponierte Fläche des Elements selbst oder die seines Elternteils. */
  grund: 'selbst' | 'eltern';
}

interface Messung {
  vordergrund: Farbe;
  grund: Farbe;
  verhaeltnis: number;
}

// LFH-455: echte Text-/Hintergrundpaare inklusive transparenter Vorfahren.
// Keine Farbwerte aus dem Produkt importieren: eine schlechte Palette muss rot werden.
function messe(ziel: Locator, auftrag: Auftrag): Promise<Messung> {
  return ziel.evaluate((element, { vordergrund, grund: grundAb }) => {
    type F = [number, number, number, number];
    function rgb(wert: string): F {
      const m = /^rgba?\(([^)]+)\)$/.exec(wert);
      if (!m) throw new Error(`Nicht unterstützte Farbe: ${wert}`);
      const teile = m[1].split(/[\s,/]+/).map(Number);
      if (teile.length < 3 || teile.some((n) => !Number.isFinite(n))) throw new Error(wert);
      return [teile[0], teile[1], teile[2], teile[3] ?? 1];
    }
    function darueber(vorne: F, hinten: F): F {
      const a = vorne[3] + hinten[3] * (1 - vorne[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2]
        .map((i) => (vorne[i] * vorne[3] + hinten[i] * hinten[3] * (1 - vorne[3])) / a)
        .concat(a) as F;
    }
    function luminanz(f: F) {
      const linear = f.slice(0, 3).map((n) => {
        const s = n / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    const vorfahren: Element[] = [];
    const start = grundAb === 'eltern' ? element.parentElement : element;
    for (let e: Element | null = start; e; e = e.parentElement) vorfahren.push(e);
    let grund: F = [0, 0, 0, 0];
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
    const vorne = darueber(rgb(getComputedStyle(element).getPropertyValue(vordergrund)), grund);
    const [a, b] = [luminanz(vorne), luminanz(grund)].sort((x, y) => x - y);
    return { vordergrund: vorne, grund, verhaeltnis: (b + 0.05) / (a + 0.05) };
  }, auftrag);
}

export async function kontrast(tag: Locator) {
  const m = await messe(tag, { vordergrund: 'color', grund: 'selbst' });
  return { text: m.vordergrund, grund: m.grund, verhaeltnis: m.verhaeltnis };
}

/**
 * Kontrast einer Randfarbe (WCAG 1.4.11) gegen BEIDE angrenzenden Flächen: `innen` ist die
 * komponierte Fläche des Elements selbst (der Rand steht auf ihr, `background-clip` ist
 * `border-box`), `aussen` die des Elternteils — der Grund, vor dem die Kante als Kante
 * erscheint. Welche der beiden trägt, entscheidet der Aufrufer und schreibt es hin.
 *
 * Eine Randbreite von 0 ist ein Fehler, keine Messung: ein unsichtbarer Rand hätte sonst
 * den Kontrast seiner Farbe, die niemand sieht.
 */
export async function randKontrast(ziel: Locator, seite: 'left' | 'top' = 'left') {
  const breite = await ziel.evaluate(
    (el, s) => parseFloat(getComputedStyle(el).getPropertyValue(`border-${s}-width`)),
    seite,
  );
  if (!(breite > 0)) throw new Error(`Rand ${seite} hat keine Breite (${breite})`);
  const vordergrund = `border-${seite}-color`;
  const innen = await messe(ziel, { vordergrund, grund: 'selbst' });
  const aussen = await messe(ziel, { vordergrund, grund: 'eltern' });
  // Ein durchscheinender Rand liegt IMMER auf der inneren Fläche; gegen `aussen` käme er dann
  // aus einer Komposition, die es auf dem Schirm nicht gibt. Ablehnen statt scheinpräzise.
  if (innen.vordergrund.join() !== aussen.vordergrund.join())
    throw new Error(`Durchscheinender Rand nicht modelliert: ${JSON.stringify({ innen, aussen })}`);
  return {
    breite,
    rand: innen.vordergrund,
    innen: innen.grund,
    aussen: aussen.grund,
    gegenInnen: innen.verhaeltnis,
    gegenAussen: aussen.verhaeltnis,
  };
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
