/**
 * Die Fernmeldeskizze als Bild (LFH-1028): aus dem gezeichneten SVG ein PNG, das als Anlage an
 * Lagebericht oder Befehl geht und dort unverändert bleibt.
 *
 * Ein SVG, das als Bild geladen wird, sieht weder die Stylesheets noch die Schriften der Seite.
 * {@link serialisiereSvg} schreibt deshalb die berechneten Darstellungswerte jedes Elements inline
 * (Farben aus `currentColor` und `var(--lfh-…)` stehen dann als Wert da) und legt die Schriften
 * als `@font-face` mit Daten-URL in das SVG. {@link rastere} malt es auf weißen Grund.
 */

import { SCHRIFTSCHNITTE, type Schriftschnitt } from '../../theme/schriften';

/** Darstellungswerte, die ein Element der Skizze aus Stylesheets und Vererbung bezieht. */
const STIL_EIGENSCHAFTEN = [
  'color',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'text-decoration',
  'paint-order',
] as const;

/** Merkmale der Bedienung; im Bild tragen sie nichts. */
const BEDIEN_MERKMAL = /^(aria-|data-|tabindex$|role$|class$|focusable$)/;

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgSerialisierung {
  /** Breite und Höhe des Bildes in Pixeln. */
  breite: number;
  hoehe: number;
  /** `@font-face`-Regeln mit Daten-URL ({@link schriftRegeln}); leer ohne eingebettete Schrift. */
  schriften?: string;
  /** Berechneter Stil; Vorgabe `getComputedStyle`. */
  stil?: (el: Element) => Pick<CSSStyleDeclaration, 'getPropertyValue'>;
}

/** Das SVG als eigenständiges Dokument mit inline aufgelösten Stilen. */
export function serialisiereSvg(svg: SVGSVGElement, optionen: SvgSerialisierung): string {
  const stil = optionen.stil ?? ((el: Element) => getComputedStyle(el));
  const kopie = svg.cloneNode(true) as SVGSVGElement;
  const original = [svg, ...svg.querySelectorAll('*')];
  const kopien = [kopie, ...kopie.querySelectorAll('*')];
  const weg: Element[] = [];
  original.forEach((el, i) => {
    const k = kopien[i];
    const cs = stil(el);
    if (cs.getPropertyValue('display') === 'none') {
      weg.push(k);
      return;
    }
    for (const name of k.getAttributeNames()) {
      if (BEDIEN_MERKMAL.test(name)) k.removeAttribute(name);
    }
    const werte = STIL_EIGENSCHAFTEN.map((p) => [p, cs.getPropertyValue(p)] as const)
      .filter(([, w]) => w !== '')
      .map(([p, w]) => `${p}:${w}`);
    const eigen = el.getAttribute('style');
    const gesamt = [eigen, ...werte].filter(Boolean).join(';');
    if (gesamt) k.setAttribute('style', gesamt);
  });
  for (const el of weg) el.remove();

  // `xmlns` schreibt der Serialisierer selbst; als Attribut stünde es doppelt, und das Bild
  // ließe sich nicht mehr laden.
  kopie.setAttribute('width', String(optionen.breite));
  kopie.setAttribute('height', String(optionen.hoehe));
  if (optionen.schriften) {
    const style = kopie.ownerDocument.createElementNS(SVG_NS, 'style');
    style.textContent = optionen.schriften;
    kopie.insertBefore(style, kopie.firstChild);
  }
  return new XMLSerializer().serializeToString(kopie);
}

/** Ein Schnitt der App-Schriften: Familie, Gewicht, Stil und absolute Adresse der Datei. */
export interface SchriftFlaeche {
  familie: string;
  gewicht: string;
  stil: string;
  url: string;
}

const ohneAnfuehrung = (s: string) => s.trim().replace(/^["']|["']$/g, '');

/** Die Schnitte der App-Schriften (`theme/schriften.ts`) für die genannten Familien. */
export function schriftFlaechen(
  schnitte: Iterable<Schriftschnitt>,
  familien: ReadonlySet<string>,
): SchriftFlaeche[] {
  const funde: SchriftFlaeche[] = [];
  for (const s of schnitte) {
    if (!familien.has(s.familie)) continue;
    funde.push({
      familie: s.familie,
      gewicht: String(s.gewicht),
      stil: 'normal',
      url: new URL(s.datei, document.baseURI).href,
    });
  }
  return funde;
}

/** Die Familiennamen aus einem `font-family`-Wert, ohne Anführung. */
export function familienAus(wert: string): string[] {
  return wert
    .split(',')
    .map(ohneAnfuehrung)
    .filter((f) => f.length > 0);
}

function alsDatenUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leser = new FileReader();
    leser.onload = () => resolve(String(leser.result));
    leser.onerror = () => reject(leser.error ?? new Error('Schrift nicht lesbar'));
    leser.readAsDataURL(blob);
  });
}

/**
 * `@font-face`-Regeln mit eingebetteter Datei für alle Familien, die im SVG vorkommen. Eine
 * Schrift, die sich nicht laden lässt, fehlt; das Bild steht dann in der Ersatzschrift.
 */
export async function schriftRegeln(svg: SVGSVGElement): Promise<string> {
  const familien = new Set<string>();
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const f of familienAus(getComputedStyle(el).getPropertyValue('font-family'))) {
      familien.add(f);
    }
  }
  const flaechen = schriftFlaechen(SCHRIFTSCHNITTE, familien);
  const regeln = await Promise.all(
    flaechen.map(async (f) => {
      try {
        const antwort = await fetch(f.url);
        if (!antwort.ok) return '';
        const daten = await alsDatenUrl(await antwort.blob());
        return `@font-face{font-family:"${f.familie}";src:url("${daten}");font-weight:${f.gewicht};font-style:${f.stil};}`;
      } catch {
        return '';
      }
    }),
  );
  return regeln.join('\n');
}

/** Längste Kante des Bildes in Pixeln: auf A4 quer gut 200 dpi. */
export const LANGE_KANTE = 2400;

/** Pixelmaße für eine Skizze mit diesen Maßen in Skizzeneinheiten. */
export function bildMasse(breite: number, hoehe: number): { breite: number; hoehe: number } {
  const faktor = LANGE_KANTE / Math.max(breite, hoehe, 1);
  return {
    breite: Math.max(1, Math.round(breite * faktor)),
    hoehe: Math.max(1, Math.round(hoehe * faktor)),
  };
}

/** Malt das serialisierte SVG auf `grund` und liefert ein PNG. */
export async function rastere(
  svgText: string,
  masse: { breite: number; hoehe: number },
  grund: string,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const bild = new Image();
    bild.src = url;
    await bild.decode();
    const leinwand = document.createElement('canvas');
    leinwand.width = masse.breite;
    leinwand.height = masse.hoehe;
    const kontext = leinwand.getContext('2d');
    if (!kontext) throw new Error('Kein Zeichenkontext');
    kontext.fillStyle = grund;
    kontext.fillRect(0, 0, masse.breite, masse.hoehe);
    kontext.drawImage(bild, 0, 0, masse.breite, masse.hoehe);
    return await new Promise<Blob>((resolve, reject) =>
      leinwand.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Bild nicht erzeugt'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Das gezeichnete SVG der Skizze als PNG auf `grund`. */
export async function skizzeAlsPng(svg: SVGSVGElement, grund: string): Promise<Blob> {
  const vb = svg.viewBox.baseVal;
  const masse = bildMasse(vb.width, vb.height);
  const schriften = await schriftRegeln(svg);
  return rastere(serialisiereSvg(svg, { ...masse, schriften }), masse, grund);
}
