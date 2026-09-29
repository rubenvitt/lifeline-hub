/**
 * Die Seitenrinne ist an ALLEN Stellen verdrahtet (LFH-329 · B1): an den zwei
 * Geschwister-Layouts (AppLayout, EinsatzLayout), an den zwei Ladeflächen in `App.tsx` (innen im
 * Content-Rahmen) und an der angepinnten ETB-Erfassungsleiste, die die Rinne negiert und als
 * eigenen Innenrand wieder aufnimmt. Wer nur eine Stelle umstellt, verschiebt die anderen.
 *
 * Quelltext-Pin statt Komponententest: Vitest fährt mit `css: false`, jsdom rechnet kein Layout.
 * Die Wirkung belegt `e2e/seitenrinne.spec.ts`. Gelesen per `node:fs` (siehe Grenze 2 in
 * `gate5.guard.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const lies = (relativ: string) => readFileSync(join(src, relativ), 'utf-8');

const APP_LAYOUT = 'components/AppLayout.tsx';
const EINSATZ_LAYOUT = 'einsatz/EinsatzLayout.tsx';
const APP = 'App.tsx';
const INDEX_CSS = 'index.css';

/** Zählt Vorkommen, Kommentare ausdrücklich eingeschlossen: ein Erklärtext in einer GEPRÜFTEN
 *  Datei, der das verbotene Maß zitiert, reißt das Gate. Diese Datei gehört nicht dazu. */
function treffer(text: string, muster: RegExp): number {
  return text.match(muster)?.length ?? 0;
}

describe('Seitenrinne — die Verdrahtung (LFH-329 · B1)', () => {
  it('beide Content-Rahmen lesen die Seitenrinne', () => {
    // Gezählt werden die Content-Zeilen MIT der Property, damit andere Umbauten an den Layouts
    // hier nicht rot werden; dass kein hartes Maß zurückkommt, deckt der Test darunter ab.
    for (const datei of [APP_LAYOUT, EINSATZ_LAYOUT]) {
      const zeilen = lies(datei)
        .split('\n')
        .filter((z) => z.includes('<Content'))
        .filter((z) => z.includes("padding: 'var(--lfh-seiten-polsterung)'"));
      expect(zeilen, `${datei}: genau ein Content-Rahmen liest die Rinne`).toHaveLength(1);
    }
  });

  it('auch die zwei Ladeflächen in App.tsx hängen an der Rinne', () => {
    // Als hartes Maß addierten sie auf dem Handschirm den vollen Fükw-Rand obendrauf.
    expect(treffer(lies(APP), /padding: 'var\(--lfh-seiten-polsterung\)'/g)).toBe(2);
  });

  it('keine der drei Dateien trägt mehr ein hartes Polsterungsmaß', () => {
    for (const datei of [APP_LAYOUT, EINSATZ_LAYOUT, APP]) {
      expect(treffer(lies(datei), /padding: 24/g), datei).toBe(0);
    }
  });

  it('die ETB-Erfassungsleiste leitet BEIDE Ränder ab', () => {
    // Nur den negativen Außenrand abzuleiten reicht nicht: der Text stünde dann nicht mehr auf der
    // Rinne.
    const block = lies(INDEX_CSS).match(/\.etb-erfassung-sticky\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/margin:\s*0 calc\(-1 \* var\(--lfh-seiten-polsterung\)\)/);
    expect(block![1]).toMatch(/padding:\s*12px var\(--lfh-seiten-polsterung\) 14px/);
  });

  it('index.css nennt das alte Maß nirgends mehr — auch nicht in Prosa', () => {
    // Über die ganze Datei und ohne Kommentar-Ausnahme. Gesucht wird die Zahl als Maß (`24px`),
    // nicht die Ziffernfolge, sonst bräche die Prüfung an `1240` oder `0.24s`.
    expect(treffer(lies(INDEX_CSS), /\b24px\b/g)).toBe(0);
  });
});
