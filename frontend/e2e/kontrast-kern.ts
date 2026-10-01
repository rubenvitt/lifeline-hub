import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Messkern für Text-/Hintergrund- und Randkontrast, geteilt von allen Kontrast-Specs. Eine
 * Kopie je Spec driftete still auseinander und machte beide Nachweise wertlos.
 */

type Farbe = [number, number, number, number];

interface Auftrag {
  /** CSS-Eigenschaft des Vordergrunds, z. B. `color`, `border-left-color` oder `box-shadow`. */
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
    let wert = getComputedStyle(element).getPropertyValue(vordergrund);
    // Eine Schattenlinie (`box-shadow: inset …`) misst ihre Farbe; mehrere Schatten nur, wenn
    // sie dieselbe Farbe tragen — sonst wäre unklar, welche Linie gemeint ist.
    if (vordergrund === 'box-shadow') {
      const farben = wert.match(/rgba?\([^)]*\)/g);
      if (!farben) throw new Error(`Kein Schatten an ${element.tagName}: ${wert}`);
      if (new Set(farben).size !== 1) throw new Error(`Schatten in mehreren Farben: ${wert}`);
      wert = farben[0];
    }
    const vorne = darueber(rgb(wert), grund);
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
 * Kontrast eines Fokusumrisses (`outline`, WCAG 1.4.11) gegen den Grund, auf dem er steht
 * (LFH-737). Mit `outline-offset` ≥ 0 liegt der Umriss AUSSERHALB der Border-Box, also auf der
 * Fläche des Elternteils; ein negativer Versatz legt ihn auf die eigene Fläche.
 *
 * Kein Umriss ist ein Fehler, keine Messung: Stil `none` oder Breite 0 hätte sonst den Kontrast
 * einer Farbe, die niemand sieht (antd zeichnet ihn nur unter `:focus-visible`).
 */
export async function umrissKontrast(ziel: Locator) {
  const umriss = await ziel.evaluate((el) => {
    const stil = getComputedStyle(el);
    return {
      stil: stil.outlineStyle,
      breite: parseFloat(stil.outlineWidth),
      versatz: parseFloat(stil.outlineOffset),
    };
  });
  if (umriss.stil === 'none' || !(umriss.breite > 0))
    throw new Error(`Kein Fokusumriss gezeichnet: ${JSON.stringify(umriss)}`);
  const m = await messe(ziel, {
    vordergrund: 'outline-color',
    grund: umriss.versatz < 0 ? 'selbst' : 'eltern',
  });
  return { ...umriss, umriss: m.vordergrund, grund: m.grund, verhaeltnis: m.verhaeltnis };
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

/**
 * WCAG-Verhältnis zweier opaker Farben, für Paare, die nicht an EINEM Element hängen. Dieselbe
 * Formel wie in `messe` — dort läuft sie im Browser (`evaluate`) und kann nicht hierher zeigen.
 */
export function verhaeltnis(a: Farbe, b: Farbe): number {
  const luminanz = (f: Farbe) => {
    const linear = f.slice(0, 3).map((n) => {
      const s = n / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const [x, y] = [luminanz(a), luminanz(b)].sort((p, q) => p - q);
  return (y + 0.05) / (x + 0.05);
}

/**
 * Die Form der Schattenlinie: GENAU zwei `inset`-Schatten ohne Weichzeichnung und ohne
 * waagerechten Versatz, einer nach unten (Oberlinie), einer nach oben (Unterlinie), je mindestens
 * 1 px. Ein Ring (`0 0 0 2px`, die Form des Fokusrings), ein äußerer Schatten, eine einzelne Linie
 * oder eine Nulllinie wären unsichtbar oder etwas anderes, aber farblich messbar — deshalb vorab.
 */
async function pruefeLinienform(ziel: Locator) {
  const wert = await ziel.evaluate((el) => getComputedStyle(el).boxShadow);
  // Kommas innerhalb von `rgb(…)` trennen keine Schatten.
  const schatten = wert.split(/,(?![^(]*\))/).map((t) => t.trim());
  const form = schatten.map((t) => {
    const laengen = t
      .replace(/rgba?\([^)]*\)/, '')
      .replace('inset', '')
      .trim()
      .split(/\s+/)
      .map((l) => parseFloat(l));
    const [x = NaN, y = NaN, unschaerfe = 0, ausdehnung = 0] = laengen;
    return { inset: /\binset\b/.test(t), x, y, unschaerfe, ausdehnung };
  });
  const beschreibung = `box-shadow: ${wert}`;
  expect(form, beschreibung).toHaveLength(2);
  for (const f of form) {
    expect(f.inset, beschreibung).toBe(true);
    expect(f.x, beschreibung).toBe(0);
    expect(f.unschaerfe, beschreibung).toBe(0);
    expect(f.ausdehnung, beschreibung).toBe(0);
  }
  const ys = form.map((f) => f.y).sort((a, b) => a - b);
  expect(ys[0], `Unterlinie fehlt — ${beschreibung}`).toBeLessThanOrEqual(-1);
  expect(ys[1], `Oberlinie fehlt — ${beschreibung}`).toBeGreaterThanOrEqual(1);
}

/**
 * Kontrast einer Schattenlinie (`box-shadow: inset …`, LFH-698) gegen die Fläche, auf der sie
 * liegt, UND gegen die Fläche eines Nachbarn — die Linie trennt die Zeile von beiden. Ein Element
 * ohne Schatten oder mit einer anderen Schattenform ist ein Fehler, keine Messung.
 */
export async function schattenKontrast(ziel: Locator, nachbar: Locator) {
  await pruefeLinienform(ziel);
  const innen = await messe(ziel, { vordergrund: 'box-shadow', grund: 'selbst' });
  const { grund: nachbarGrund } = await messe(nachbar, { vordergrund: 'color', grund: 'selbst' });
  return {
    linie: innen.vordergrund,
    flaeche: innen.grund,
    nachbar: nachbarGrund,
    gegenFlaeche: innen.verhaeltnis,
    gegenNachbar: verhaeltnis(innen.vordergrund, nachbarGrund),
  };
}

/** Komponierte Fläche eines Elements (alle Vorfahren übereinander), opak. */
export async function flaeche(ziel: Locator): Promise<Farbe> {
  return (await messe(ziel, { vordergrund: 'color', grund: 'selbst' })).grund;
}

/**
 * Misst erst, wenn das Bild STEHT: antd blendet Knopffläche und -farbe über, und ein früher
 * Wechsel ist ein Zwischenbild (gemessen 1 Farbwert neben der Ruhe), das jede Hover-Farbe
 * bestünde. Gewartet wird auf das Ende aller Übergänge, dann müssen zwei Messungen gleich sein.
 * Einblendungen (Karte, Modal) laufen als Opacity-Gruppe, die der Messkern ablehnt, bis sie
 * stehen.
 */
export async function stehend(ziel: Locator, name: string) {
  let messung: Awaited<ReturnType<typeof kontrast>> | undefined;
  const ende = () =>
    ziel.evaluate((el) =>
      Promise.all(
        [el, ...el.querySelectorAll('*')].flatMap((e) => e.getAnimations()).map((a) => a.finished),
      ),
    );
  await expect(async () => {
    await ende();
    const erste = await kontrast(ziel);
    await ende();
    messung = await kontrast(ziel);
    expect(messung, `${name} steht`).toEqual(erste);
  }).toPass({ timeout: 10_000 });
  return messung!;
}

/**
 * Beschriftung auf einer Bedien- oder Gefahrfläche in Ruhe UND unter dem Zeiger (LFH-661,
 * LFH-693; Spec `farbrollen-kontrast`). Kein eigener Knopfboden: die Begründung setzt voraus,
 * dass die Beschriftung kein Großtext nach WCAG 1.4.3 ist (fett erst ab 18,66 px). Wächst sie
 * darüber, ist das neu zu fragen. Unter dem Zeiger wird erst gemessen, wenn der Zustand
 * gewechselt hat; sonst wäre „Hover gemessen“ trivial wahr. Was wechselt, sagt `wechsel`: die
 * Fläche (gefüllter Knopf, Menüeintrag) oder die Schrift (umrandeter Knopf, Fläche bleibt).
 */
export async function ruheUndZeiger(
  page: Page,
  ziel: Locator,
  schranke: number,
  name: string,
  wechsel: 'grund' | 'text' = 'grund',
) {
  await expect(ziel, name).toBeVisible();
  const schrift = await ziel.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(schrift, `${name}: Schriftgröße`).toBeLessThan(18.66);
  // Kein Zeiger, kein Fokus: die Ruhe.
  await page.mouse.move(0, 0);
  await ziel.evaluate((el) => (el as HTMLElement).blur());
  const ruhe = await stehend(ziel, `${name}, Ruhe`);
  expect(ruhe.verhaeltnis, `${name}, Ruhe: ${JSON.stringify(ruhe)}`).toBeGreaterThanOrEqual(
    schranke,
  );

  await ziel.hover();
  const wechselText = `${name}: ${wechsel === 'grund' ? 'Fläche' : 'Schrift'} unter dem Zeiger wechselt`;
  await expect(async () => {
    const zeiger = await kontrast(ziel);
    expect(zeiger[wechsel], wechselText).not.toEqual(ruhe[wechsel]);
  }).toPass({ timeout: 10_000 });
  const zeiger = await stehend(ziel, `${name}, Zeiger`);
  expect(zeiger[wechsel], wechselText).not.toEqual(ruhe[wechsel]);
  expect(zeiger.verhaeltnis, `${name}, Zeiger: ${JSON.stringify(zeiger)}`).toBeGreaterThanOrEqual(
    schranke,
  );
  return { ruhe, zeiger };
}
