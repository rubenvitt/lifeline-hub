import { expect, type Locator } from '@playwright/test';

/**
 * Messkern für Text-/Hintergrund- und Randkontrast, geteilt von allen Kontrast-Specs. Eine
 * Kopie je Spec driftete still auseinander und machte beide Nachweise wertlos.
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

// Echte Text-/Hintergrundpaare inklusive transparenter Vorfahren. Keine Farbwerte aus dem
// Produkt importieren: eine schlechte Palette muss rot werden.
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

/**
 * Wartet, bis Element und Vorfahren eingeschwungen sind (LFH-702, Spec `textkontrast-rollen`,
 * „Messung im eingeschwungenen Zustand"). Eine antd-Tabellenzeile geht unter dem Zeiger per
 * Transition von `flaeche` nach `flaeche3` über; ein Versuch mittendrin las einen helleren Grund,
 * bestand, und `toPass` beendete die Schleife — der Test war grün oder rot je nach Zeitpunkt.
 *
 * `getComputedStyle` stößt die Stilberechnung an, erst danach gibt es die Transition eines gerade
 * gesetzten `:hover`. Endlose Animationen (Ladekreisel) zählen nicht; eine endliche, die nicht
 * rechtzeitig endet, ist ein Fehler mit Namen und Ziel, keine Messung.
 */
async function eingeschwungen(ziel: Locator) {
  await ziel.evaluate(async (element) => {
    const kette = new Set<Element>();
    for (let e: Element | null = element; e; e = e.parentElement) {
      kette.add(e);
      void getComputedStyle(e).backgroundColor;
    }
    const laufend = document.getAnimations().filter((a) => {
      const effekt = a.effect as KeyframeEffect | null;
      return (
        a.playState === 'running' &&
        !!effekt?.target &&
        kette.has(effekt.target) &&
        effekt.getComputedTiming().iterations !== Infinity
      );
    });
    const beschreibung = laufend
      .map((a) => {
        const t = (a.effect as KeyframeEffect).target as Element;
        const name = a instanceof CSSTransition ? a.transitionProperty : a.id || a.constructor.name;
        return `${name} an ${t.tagName}.${t.className}`;
      })
      .join(', ');
    const frist = new Promise<never>((_, nein) =>
      setTimeout(() => nein(new Error(`Nicht eingeschwungen nach 5 s: ${beschreibung}`)), 5_000),
    );
    await Promise.race([Promise.all(laufend.map((a) => a.finished.catch(() => undefined))), frist]);
  });
}

export async function pruefe(tag: Locator, minimum: number, name: string) {
  await expect(tag, name).toBeVisible();
  // Modal-Einblendung erst abwarten: Opacity-Gruppen liefern keine belastbare Messung.
  // Ein dauerhaft nicht unterstützter Stil bleibt ein Fehler, statt still zu bestehen.
  // Jeder Versuch schwingt zuerst ein: schon der erste misst den Endwert, ein Wert unter dem
  // Boden bleibt in jedem Versuch rot (LFH-702).
  await expect(async () => {
    await eingeschwungen(tag);
    const messung = await kontrast(tag);
    expect(messung.verhaeltnis, `${name}: ${JSON.stringify(messung)}`).toBeGreaterThanOrEqual(
      minimum,
    );
  }).toPass({ timeout: 10_000 });
}
