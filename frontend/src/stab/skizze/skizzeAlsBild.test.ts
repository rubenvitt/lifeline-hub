import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LANGE_KANTE,
  bildMasse,
  familienAus,
  schriftFlaechen,
  schriftRegeln,
  serialisiereSvg,
} from './skizzeAlsBild';
import { SCHRIFTSCHNITTE } from '../../theme/schriften';

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
  it('findet die Schnitte der genannten Familien samt absoluter Adresse', () => {
    const funde = schriftFlaechen(
      [
        { familie: 'LFH Archivo', gewicht: 500, datei: '/assets/archivo-500-abc.woff2' },
        { familie: 'Fremd', gewicht: 400, datei: '/fremd.woff2' },
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
    const narrow = SCHRIFTSCHNITTE.filter((s) => s.familie === 'LFH Archivo Narrow');
    expect(narrow).toHaveLength(1);
    const abruf = vi.fn(async () => new Response(new Blob(['woff2'], { type: 'font/woff2' })));
    vi.stubGlobal('fetch', abruf);

    const regeln = await schriftRegeln(skizze(`'LFH Archivo Narrow', Fremd, sans-serif`));

    expect(abruf).toHaveBeenCalledTimes(1);
    expect(abruf).toHaveBeenCalledWith(new URL(narrow[0].datei, document.baseURI).href);
    expect(regeln).toMatch(
      /^@font-face\{font-family:"LFH Archivo Narrow";src:url\("data:[^"]*;base64,[^"]+"\);font-weight:600;font-style:normal;\}$/,
    );
  });

  it('lässt eine Schrift weg, die sich nicht laden lässt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await schriftRegeln(skizze(`'LFH Archivo Narrow'`))).toBe('');
  });
});
