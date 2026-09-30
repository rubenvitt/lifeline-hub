import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { farbenDunkel } from '../theme/tokens';
import {
  LINIE_ECKE,
  LINIE_GEHRUNGSGRENZE,
  LINIE_PFAD,
  LINIE_STAERKE,
  MARKE_RAHMEN,
  QUADRAT,
} from './bildmarkeGeometrie';

/**
 * Guard der Bildmarke „Lebenslinie“ (LFH-837, Design D6).
 *
 * Hält fest, was kein Render-Test sieht: Jede Symboldatei hat ihre Nenngröße, jede Quelle
 * zeichnet dieselbe Geometrie wie die Oberfläche, und das maskierbare Symbol bleibt im sicheren
 * Kreis. Schlägt ein Fall fehl, gilt: Geometrie in `bildmarkeGeometrie.ts` ändern, Quellen in
 * `scripts/marke/` nachziehen, `scripts/marke/erzeuge-symbole.sh` laufen lassen.
 */

const hier = dirname(fileURLToPath(import.meta.url));
const frontend = join(hier, '..', '..');
const repo = join(frontend, '..');
const oeffentlich = join(frontend, 'public');
const huellenSymbole = join(repo, 'src-tauri', 'icons');
const quellen = join(repo, 'scripts', 'marke');

const pwaManifest = JSON.parse(readFileSync(join(hier, 'pwaManifest.json'), 'utf8')) as {
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

const QUELLEN = ['symbol.svg', 'symbol-maskable.svg', 'symbol-macos.svg'] as const;
const KOPF_SCHWARZ = farbenDunkel.kopf;

/** Breite und Höhe aus dem IHDR-Block einer PNG-Datei. */
function pngMasse(pfad: string): { breite: number; hoehe: number } {
  const daten = readFileSync(pfad);
  expect(daten.subarray(12, 16).toString('ascii'), `${pfad} ist keine PNG`).toBe('IHDR');
  return { breite: daten.readUInt32BE(16), hoehe: daten.readUInt32BE(20) };
}

/** Nenngröße eines Hüllensymbols aus seinem Namen (Namensschema von `cargo tauri icon`). */
function nenngroesseHuelle(name: string): number | null {
  const raster = /^(\d+)x\1(@2x)?\.png$/.exec(name);
  if (raster) return Number(raster[1]) * (raster[2] ? 2 : 1);
  const kachel = /^Square(\d+)x\1Logo\.png$/.exec(name);
  if (kachel) return Number(kachel[1]);
  if (name === 'StoreLogo.png') return 50;
  if (name === 'icon.png') return 512;
  return null;
}

/**
 * Umschließendes Rechteck der gezeichneten Marke, analytisch aus Pfad und Strich: stumpfe Enden,
 * Gehrungsspitzen außen, Schnittpunkte innen, dazu das Quadrat. Prüft zugleich, dass jede Ecke
 * unter der Gehrungsgrenze bleibt (sonst zeichnete der Renderer eine Fase).
 */
function gezeichneterRahmen() {
  const punkte: [number, number][] = [];
  for (const [, befehl, zahlen] of LINIE_PFAD.matchAll(/([MHL])([^MHL]*)/g)) {
    const w = (zahlen.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    punkte.push(befehl === 'H' ? [w[0], punkte[punkte.length - 1][1]] : [w[0], w[1]]);
  }
  const halb = LINIE_STAERKE / 2;
  const norm = ([x, y]: [number, number]): [number, number] => {
    const l = Math.hypot(x, y);
    return [x / l, y / l];
  };
  const umriss: [number, number][] = [];
  for (const [p, q] of [
    [punkte[0], punkte[1]],
    [punkte[punkte.length - 1], punkte[punkte.length - 2]],
  ]) {
    const [dx, dy] = norm([q[0] - p[0], q[1] - p[1]]);
    umriss.push([p[0] - dy * halb, p[1] + dx * halb], [p[0] + dy * halb, p[1] - dx * halb]);
  }
  for (let i = 1; i < punkte.length - 1; i++) {
    const p = punkte[i];
    const a = norm([punkte[i - 1][0] - p[0], punkte[i - 1][1] - p[1]]);
    const b = norm([punkte[i + 1][0] - p[0], punkte[i + 1][1] - p[1]]);
    const verhaeltnis = 1 / Math.sqrt((1 - (a[0] * b[0] + a[1] * b[1])) / 2);
    expect(verhaeltnis, `Ecke ${p}`).toBeLessThanOrEqual(LINIE_GEHRUNGSGRENZE);
    const [hx, hy] = norm([a[0] + b[0], a[1] + b[1]]);
    const abstand = halb * verhaeltnis;
    umriss.push(
      [p[0] - hx * abstand, p[1] - hy * abstand],
      [p[0] + hx * abstand, p[1] + hy * abstand],
    );
  }
  umriss.push([QUADRAT.x, QUADRAT.y], [QUADRAT.x + QUADRAT.kante, QUADRAT.y + QUADRAT.kante]);
  const xs = umriss.map(([x]) => x);
  const ys = umriss.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

describe('Bildmarke — Nenngrößen (LFH-837)', () => {
  it.each([
    ['pwa-192.png', 192],
    ['pwa-512.png', 512],
    ['pwa-maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ])('%s hat %i px Kantenlänge', (datei, kante) => {
    expect(pngMasse(join(oeffentlich, datei))).toEqual({ breite: kante, hoehe: kante });
  });

  it('jedes PNG der Desktop-Hülle hat die Größe aus seinem Namen', () => {
    const pngs = readdirSync(huellenSymbole).filter((n) => n.endsWith('.png'));
    expect(pngs.length).toBeGreaterThan(0);
    for (const name of pngs) {
      const kante = nenngroesseHuelle(name);
      expect(kante, `${name}: unbekanntes Namensschema`).not.toBeNull();
      expect(pngMasse(join(huellenSymbole, name)), name).toEqual({ breite: kante, hoehe: kante });
    }
  });
});

describe('Bildmarke — Manifest (LFH-837)', () => {
  it('führt die Symbole 192/512 als „any“ und ein eigenes maskierbares Symbol', () => {
    expect(pwaManifest.icons).toEqual([
      { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  it('jeder Eintrag verweist auf eine Datei mit genau seinen Maßen', () => {
    for (const symbol of pwaManifest.icons) {
      const [breite, hoehe] = String(symbol.sizes).split('x').map(Number);
      expect(pngMasse(join(oeffentlich, symbol.src)), symbol.src).toEqual({ breite, hoehe });
    }
  });

  it('Titelleiste und Startbildschirm sind Kopf-Schwarz, nicht rot und nicht weiß', () => {
    expect(pwaManifest.theme_color).toBe(KOPF_SCHWARZ);
    expect(pwaManifest.background_color).toBe(KOPF_SCHWARZ);
  });

  it('index.html bindet das Symbol für iPad/iPhone und die Themenfarbe ein', () => {
    const html = readFileSync(join(frontend, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain(`<meta name="theme-color" content="${KOPF_SCHWARZ}" />`);
  });
});

describe('Bildmarke — eine Geometrie (LFH-837)', () => {
  const linie = `<path d="${LINIE_PFAD}" fill="none" stroke="${farbenDunkel.text}" stroke-width="${LINIE_STAERKE}" stroke-linejoin="${LINIE_ECKE}" stroke-miterlimit="${LINIE_GEHRUNGSGRENZE}"/>`;
  const quadrat = `<rect x="${QUADRAT.x}" y="${QUADRAT.y}" width="${QUADRAT.kante}" height="${QUADRAT.kante}" fill="${farbenDunkel.marke}"/>`;

  it.each(QUELLEN)('%s zeichnet Linie und Quadrat der Oberfläche', (datei) => {
    const svg = readFileSync(join(quellen, datei), 'utf8');
    expect(svg).toContain(linie);
    expect(svg).toContain(quadrat);
    expect(svg).toContain(`fill="${KOPF_SCHWARZ}"`);
    expect(svg).not.toContain('<text');
  });

  it('MARKE_RAHMEN umschließt die gezeichnete Marke samt Gehrungen (±1)', () => {
    const r = gezeichneterRahmen();
    expect(r.x0).toBeCloseTo(MARKE_RAHMEN.x, -0.3);
    expect(r.y0).toBeCloseTo(MARKE_RAHMEN.y, -0.3);
    expect(r.x1).toBeCloseTo(MARKE_RAHMEN.x + MARKE_RAHMEN.breite, -0.3);
    expect(r.y1).toBeCloseTo(MARKE_RAHMEN.y + MARKE_RAHMEN.hoehe, -0.3);
  });

  it('die Rastergrafiken stammen aus den aktuellen Quellen (Prüfsummen-Stempel des Skripts)', () => {
    const stempel = new Map(
      readFileSync(join(quellen, 'quellen.sha256'), 'utf8')
        .trim()
        .split('\n')
        .map((zeile) => {
          const [summe, name] = zeile.split(/\s+/);
          return [name, summe] as const;
        }),
    );
    expect([...stempel.keys()].sort()).toEqual([...QUELLEN].sort());
    for (const datei of QUELLEN) {
      const summe = createHash('sha256')
        .update(readFileSync(join(quellen, datei)))
        .digest('hex');
      expect(stempel.get(datei), `${datei} geändert, Skript nicht gelaufen`).toBe(summe);
    }
  });

  it('favicon.svg ist die Quelle symbol.svg', () => {
    expect(readFileSync(join(oeffentlich, 'favicon.svg'), 'utf8')).toBe(
      readFileSync(join(quellen, 'symbol.svg'), 'utf8'),
    );
  });

  it('das maskierbare Symbol liegt ganz im sicheren Kreis (Radius 40 %)', () => {
    const svg = readFileSync(join(quellen, 'symbol-maskable.svg'), 'utf8');
    const kante = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
    const t =
      /transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\) translate\((-?[\d.]+) (-?[\d.]+)\)"/.exec(
        svg,
      );
    expect(t, 'Transformation der Marke nicht lesbar').not.toBeNull();
    const [cx, cy, s, tx, ty] = t!.slice(1).map(Number);
    const { x, y, breite, hoehe } = MARKE_RAHMEN;
    const radius = 0.4 * kante;
    for (const [px, py] of [
      [x, y],
      [x + breite, y],
      [x, y + hoehe],
      [x + breite, y + hoehe],
    ]) {
      const ax = cx + s * (px + tx) - kante / 2;
      const ay = cy + s * (py + ty) - kante / 2;
      expect(Math.hypot(ax, ay), `Ecke (${px}, ${py})`).toBeLessThanOrEqual(radius);
    }
  });
});
