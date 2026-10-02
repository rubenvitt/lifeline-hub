import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';
import { GERAETESPEICHER } from './geraetRaeumung';

/**
 * Guard (LFH-767, design.md D1): Jede Datei, die eine IndexedDB öffnet oder in `localStorage`
 * bzw. `sessionStorage` schreibt, steht in `GERAETESPEICHER` mit einer Entscheidung. Ein neuer
 * Speicherort landet so nicht still auf dem Gerät: Er muss geräumt, gebunden oder begründet
 * stehen gelassen werden.
 *
 * Gesucht wird in Code ohne Kommentare. Tests und `src/test/` sind ausgenommen, sie legen
 * Speicher gerade zum Prüfen an.
 */

const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SCHREIBT = /\bopenDB\s*[<(]|\b(?:localStorage|sessionStorage)\s*\??\.\s*setItem\b/;

export function speicherDateien(quellen: Record<string, string>): string[] {
  const treffer: string[] = [];
  for (const [pfad, inhalt] of Object.entries(quellen)) {
    if (/\.test\.tsx?$/.test(pfad) || pfad.startsWith('/src/test/')) continue;
    if (ohneKommentare(inhalt).some((zeile) => SCHREIBT.test(zeile))) treffer.push(pfad);
  }
  return treffer.sort();
}

describe('Gerätespeicher-Guard (LFH-767): jeder Speicherort hat eine Entscheidung', () => {
  it('kennt jede Datei, die auf dem Gerät speichert', () => {
    // Sicherung gegen ein kaputtes Glob-Muster: ein leerer Scan wäre still grün.
    expect(Object.keys(dateien).length).toBeGreaterThan(100);

    const verzeichnet = new Set(GERAETESPEICHER.map((e) => `/src/${e.datei}`));
    const fehlend = speicherDateien(dateien).filter((pfad) => !verzeichnet.has(pfad));
    expect(
      fehlend,
      `Diese Dateien speichern auf dem Gerät, stehen aber nicht in GERAETESPEICHER ` +
        `(offline/geraetRaeumung.ts). Bitte mit Entscheidung und Grund eintragen:\n` +
        fehlend.join('\n'),
    ).toEqual([]);
  });

  it('verzeichnet keine Datei, die es nicht (mehr) gibt oder die nichts speichert', () => {
    const gefunden = new Set(speicherDateien(dateien));
    const veraltet = GERAETESPEICHER.map((e) => `/src/${e.datei}`).filter((p) => !gefunden.has(p));
    expect(veraltet).toEqual([]);
  });

  it('begründet jede Entscheidung', () => {
    for (const eintrag of GERAETESPEICHER) {
      expect(eintrag.grund.trim().length, `${eintrag.ort}: Grund fehlt`).toBeGreaterThan(20);
    }
  });

  it('erkennt openDB, setItem mit und ohne ?. , aber keinen Kommentar (Selbst-Beweis)', () => {
    expect(
      speicherDateien({
        '/src/a/idb.ts': "const d = openDB<X>('x', 1);",
        '/src/a/lokal.ts': "window.localStorage.setItem('k', 'v');",
        '/src/a/sitzung.ts': "globalThis.sessionStorage?.setItem('k', 'v');",
        '/src/a/nurLesen.ts': "localStorage.getItem('k');",
        '/src/a/kommentar.ts': "// localStorage.setItem('k', 'v')\n/* openDB('x') */",
        '/src/a/test.test.ts': "localStorage.setItem('k', 'v');",
      }),
    ).toEqual(['/src/a/idb.ts', '/src/a/lokal.ts', '/src/a/sitzung.ts']);
  });
});
