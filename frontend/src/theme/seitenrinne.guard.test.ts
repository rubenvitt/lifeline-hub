/**
 * Die Seitenrinne ist verdrahtet — und zwar an ALLEN Stellen (LFH-329 · B1).
 *
 * WARUM DAS EIN QUELLTEXT-PIN IST UND KEIN KOMPONENTENTEST: `vite.config.ts`
 * fährt Vitest mit `css: false`, und jsdom rechnet ohnehin kein Layout. Eine
 * Media-Regel hat im Unit-Lauf also null Wirkung, und eine DOM-Assertion auf
 * `style.padding` würde zusätzlich riskieren, dass cssstyle den `var()`-Shorthand
 * verwirft — rot aus dem falschen Grund. Die Wirkung belegt `e2e/seitenrinne.spec.ts`
 * im Browser; diese Datei belegt die Verdrahtung in der Quelle. Muster:
 * `rollen.guard.test.ts` und `gate5.guard.test.ts`.
 *
 * Gelesen wird per `node:fs`, NICHT per `import.meta.glob(…?raw)` — der liefert
 * für CSS unter Vitest den Leerstring (Grenze 2 im Kopf von `gate5.guard.test.ts`).
 *
 * WARUM VIER STELLEN: die Rinne sitzt an zwei Geschwister-Layouts (AppLayout ist
 * die Ebene-1-Shell, EinsatzLayout der Einsatz-Workspace — darunter hängen die
 * Modulseiten samt ETB-Leiste), an den zwei Ladeflächen in `App.tsx`, die INNEN
 * im Content-Rahmen liegen, und an der angepinnten ETB-Erfassungsleiste, die die
 * Rinne einmal negiert und einmal als eigenen Innenrand wieder aufnimmt. Wer nur
 * eine Stelle umstellt, verschiebt die anderen gegeneinander.
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

/** Zählt Vorkommen — Kommentare ausdrücklich eingeschlossen. Genau so zählt
 *  auch das grep-Gate daneben; ein Erklärtext in einer GEPRÜFTEN Datei, der das
 *  verbotene Maß zitiert, reißt sein eigenes Gate (im Vorläuferpaket zweimal
 *  passiert). Diese Datei hier gehört nicht zu den geprüften und darf die Zahl
 *  deshalb beim Namen nennen. */
function treffer(text: string, muster: RegExp): number {
  return text.match(muster)?.length ?? 0;
}

describe('Seitenrinne — die Verdrahtung (LFH-329 · B1)', () => {
  it('beide Content-Rahmen lesen die Seitenrinne', () => {
    // Geprüft wird die Zahl der Content-Zeilen MIT der Property, nicht die Zahl
    // der Content-Zeilen: an beiden Layouts arbeiten parallel andere Pakete
    // (Navigationsrahmen, Kopfzeile). Ein zusätzlicher `<Content`-naher Umbau
    // dort darf nicht hier rot werden — dass kein hartes Maß zurückkommt, deckt
    // der Test darunter unabhängig ab.
    for (const datei of [APP_LAYOUT, EINSATZ_LAYOUT]) {
      const zeilen = lies(datei)
        .split('\n')
        .filter((z) => z.includes('<Content'))
        .filter((z) => z.includes("padding: 'var(--lfh-seiten-polsterung)'"));
      expect(zeilen, `${datei}: genau ein Content-Rahmen liest die Rinne`).toHaveLength(1);
    }
  });

  it('auch die zwei Ladeflächen in App.tsx hängen an der Rinne', () => {
    // Sie liegen INNERHALB des Content-Rahmens. Als hartes Maß addierten sie
    // auf dem Handschirm noch einmal den vollen Fükw-Rand obendrauf.
    expect(treffer(lies(APP), /padding: 'var\(--lfh-seiten-polsterung\)'/g)).toBe(2);
  });

  it('keine der drei Dateien trägt mehr ein hartes Polsterungsmaß', () => {
    for (const datei of [APP_LAYOUT, EINSATZ_LAYOUT, APP]) {
      expect(treffer(lies(datei), /padding: 24/g), datei).toBe(0);
    }
  });

  it('die ETB-Erfassungsleiste leitet BEIDE Ränder ab', () => {
    // Nur den negativen Außenrand abzuleiten reicht nicht: dann zöge die Leiste
    // zwar randlos über die Rinne, ihr Text stünde aber nicht mehr auf ihr.
    const block = lies(INDEX_CSS).match(/\.etb-erfassung-sticky\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/margin:\s*0 calc\(-1 \* var\(--lfh-seiten-polsterung\)\)/);
    expect(block![1]).toMatch(/padding:\s*12px var\(--lfh-seiten-polsterung\) 14px/);
  });

  it('index.css nennt das alte Maß nirgends mehr — auch nicht in Prosa', () => {
    // Bewusst über die ganze Datei und ohne Kommentar-Ausnahme: der erklärende
    // Text über der Leiste nannte die Zahl wörtlich und muss umgeschrieben
    // werden, nicht zitiert.
    expect(treffer(lies(INDEX_CSS), /24/g)).toBe(0);
  });
});
