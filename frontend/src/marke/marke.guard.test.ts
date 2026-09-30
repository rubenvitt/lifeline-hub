import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { farbenDunkel } from '../theme/tokens';
import { LINIE_PFAD, LINIE_STAERKE, MARKE_RAHMEN, QUADRAT } from './bildmarkeGeometrie';
import { pwaManifest } from './pwaManifest';

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
    for (const symbol of pwaManifest.icons ?? []) {
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
  const linie = `<path d="${LINIE_PFAD}" fill="none" stroke="${farbenDunkel.text}" stroke-width="${LINIE_STAERKE}"`;
  const quadrat = `<rect x="${QUADRAT.x}" y="${QUADRAT.y}" width="${QUADRAT.kante}" height="${QUADRAT.kante}" fill="${farbenDunkel.marke}"/>`;

  it.each(QUELLEN)('%s zeichnet Linie und Quadrat der Oberfläche', (datei) => {
    const svg = readFileSync(join(quellen, datei), 'utf8');
    expect(svg).toContain(linie);
    expect(svg).toContain(quadrat);
    expect(svg).toContain(`fill="${KOPF_SCHWARZ}"`);
    expect(svg).not.toContain('<text');
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
