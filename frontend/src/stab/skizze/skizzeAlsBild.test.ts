import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LANGE_KANTE,
  bildMasse,
  familienAus,
  schriftFlaechen,
  schriftRegeln,
  serialisiereSvg,
} from './skizzeAlsBild';

function svgAus(markup: string): SVGSVGElement {
  const huelle = document.createElement('div');
  huelle.innerHTML = markup;
  return huelle.querySelector('svg')!;
}

/** Berechneter Stil je Element aus einer Tabelle nach `data-teil`; sonst leer. */
function stilAus(tabelle: Record<string, Record<string, string>>) {
  return (el: Element) => ({
    getPropertyValue: (p: string) => tabelle[el.getAttribute('data-teil') ?? '']?.[p] ?? '',
  });
}

describe('serialisiereSvg', () => {
  const svg = () =>
    svgAus(
      `<svg viewBox="0 0 200 100" width="100%" role="group" aria-label="Fernmeldeskizze">
        <g data-ebene="stellen">
          <rect data-teil="kasten" tabindex="0" style="fill: var(--lfh-flaeche)" stroke="currentColor" />
          <text data-teil="name" class="x">Abschnitt Nord</text>
          <g data-teil="meldung"><text>Fehler</text></g>
        </g>
      </svg>`,
    );

  it('schreibt die berechneten Werte inline, nach dem eigenen Stil', () => {
    const text = serialisiereSvg(svg(), {
      breite: 400,
      hoehe: 200,
      stil: stilAus({
        kasten: { fill: 'rgb(255, 255, 255)', stroke: 'rgb(0, 0, 0)', 'stroke-width': '2px' },
        name: { 'font-family': '"LFH Archivo", sans-serif', 'font-size': '12px' },
      }),
    });
    expect(text).toContain(
      'style="fill: var(--lfh-flaeche);fill:rgb(255, 255, 255);stroke:rgb(0, 0, 0);stroke-width:2px"',
    );
    expect(text).toContain('font-family:&quot;LFH Archivo&quot;, sans-serif;font-size:12px');
  });

  it('nimmt Bedienmerkmale heraus und setzt die Pixelmaße', () => {
    const text = serialisiereSvg(svg(), { breite: 400, hoehe: 200, stil: stilAus({}) });
    expect(text).not.toMatch(/tabindex|aria-|data-|role=|class=/);
    // Genau einmal: doppelt wäre das Dokument kein gültiges XML mehr.
    expect(text.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
    expect(text).toContain('width="400"');
    expect(text).toContain('height="200"');
    expect(text).toContain('viewBox="0 0 200 100"');
  });

  it('lässt weg, was nicht dargestellt wird', () => {
    const text = serialisiereSvg(svg(), {
      breite: 400,
      hoehe: 200,
      stil: stilAus({ meldung: { display: 'none' } }),
    });
    expect(text).toContain('Abschnitt Nord');
    expect(text).not.toContain('Fehler');
  });

  it('legt die Schriften als erstes Kind ins SVG', () => {
    const text = serialisiereSvg(svg(), {
      breite: 400,
      hoehe: 200,
      schriften: '@font-face{font-family:"LFH Archivo";src:url("data:font/woff2;base64,AA");}',
      stil: stilAus({}),
    });
    expect(text).toMatch(/^<svg[^>]*><style>@font-face\{font-family:"LFH Archivo"/);
  });

  it('lässt das gezeichnete SVG unverändert', () => {
    const original = svg();
    const vorher = original.outerHTML;
    serialisiereSvg(original, { breite: 400, hoehe: 200, stil: stilAus({}) });
    expect(original.outerHTML).toBe(vorher);
  });
});

describe('schriftFlaechen', () => {
  const regel = (css: Record<string, string>) => ({
    cssText: '@font-face { … }',
    style: { getPropertyValue: (p: string) => css[p] ?? '' },
  });
  const blatt = (regeln: unknown[], href: string | null = null) =>
    ({ cssRules: regeln, href }) as unknown as CSSStyleSheet;

  it('findet die Schnitte der genannten Familien samt absoluter Adresse', () => {
    const funde = schriftFlaechen(
      [
        blatt([
          regel({
            'font-family': '"LFH Archivo"',
            src: 'url("/assets/archivo-500-abc.woff2") format("woff2")',
            'font-weight': '500',
          }),
          regel({ 'font-family': 'Fremd', src: 'url(/fremd.woff2)' }),
          { cssText: '.x { color: red }' },
        ]),
      ],
      new Set(['LFH Archivo']),
    );
    expect(funde).toEqual([
      {
        familie: 'LFH Archivo',
        gewicht: '500',
        stil: 'normal',
        url: new URL('/assets/archivo-500-abc.woff2', document.baseURI).href,
      },
    ]);
  });

  it('überspringt ein Blatt, das seine Regeln nicht herausgibt', () => {
    const verschlossen = {
      get cssRules(): never {
        throw new DOMException('fremd', 'SecurityError');
      },
    } as unknown as CSSStyleSheet;
    expect(schriftFlaechen([verschlossen], new Set(['LFH Archivo']))).toEqual([]);
  });
});

describe('familienAus', () => {
  it('trennt die Liste und nimmt die Anführung ab', () => {
    expect(familienAus(`"LFH JetBrains Mono", ui-monospace, 'SF Mono', monospace`)).toEqual([
      'LFH JetBrains Mono',
      'ui-monospace',
      'SF Mono',
      'monospace',
    ]);
  });
});

describe('bildMasse', () => {
  it('bringt die längere Kante auf LANGE_KANTE und hält das Seitenverhältnis', () => {
    expect(bildMasse(1200, 800)).toEqual({ breite: LANGE_KANTE, hoehe: 1600 });
    expect(bildMasse(500, 1000)).toEqual({ breite: 1200, hoehe: LANGE_KANTE });
  });
});

describe('schriftRegeln', () => {
  /** jsdom verwirft `src` in `@font-face`; die Blätter stehen deshalb als Attrappe da. */
  function blaetter(regeln: Record<string, string>[]) {
    const blatt = {
      href: null,
      cssRules: regeln.map((css) => ({
        cssText: '@font-face { … }',
        style: { getPropertyValue: (p: string) => css[p] ?? '' },
      })),
    };
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([blatt] as unknown as StyleSheetList);
  }
  function skizze(schrift: string) {
    const svg = svgAus(
      `<svg viewBox="0 0 10 10"><text style="font-family: ${schrift}">A</text></svg>`,
    );
    document.body.append(svg);
    return svg;
  }

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('bettet die Schriften der Skizze als Daten-URL ein, fremde nicht', async () => {
    blaetter([
      {
        'font-family': '"LFH Archivo"',
        src: 'url("/assets/archivo-500.woff2") format("woff2")',
        'font-weight': '500',
      },
      { 'font-family': 'Fremd', src: 'url(/assets/fremd.woff2)' },
    ]);
    const abruf = vi.fn(async () => new Response(new Blob(['woff2'], { type: 'font/woff2' })));
    vi.stubGlobal('fetch', abruf);

    const regeln = await schriftRegeln(skizze(`'LFH Archivo', sans-serif`));

    expect(abruf).toHaveBeenCalledTimes(1);
    expect(abruf).toHaveBeenCalledWith(new URL('/assets/archivo-500.woff2', document.baseURI).href);
    expect(regeln).toMatch(
      /^@font-face\{font-family:"LFH Archivo";src:url\("data:[^"]*;base64,[^"]+"\);font-weight:500;font-style:normal;\}$/,
    );
  });

  it('lässt eine Schrift weg, die sich nicht laden lässt', async () => {
    blaetter([{ 'font-family': 'LFH Archivo', src: 'url(/weg.woff2)' }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await schriftRegeln(skizze(`'LFH Archivo'`))).toBe('');
  });
});
