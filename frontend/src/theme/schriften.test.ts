/**
 * Schriften über die FontFace-API (LFH-1108, `druck/AGENTS.md`, Schriften im Druck). Die
 * CSS-Dateien werden als TEXT gelesen: Vitest liefert CSS über Vite-Importe leer.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCHRIFTSCHNITTE, meldeSchriftenAn } from './schriften';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssDateien(verzeichnis: string, praefix = ''): [string, string][] {
  const treffer: [string, string][] = [];
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const rel = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) treffer.push(...cssDateien(pfad, rel));
    else if (eintrag.name.endsWith('.css')) treffer.push([rel, readFileSync(pfad, 'utf8')]);
  }
  return treffer;
}

describe('Schriften (LFH-1108)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('kein CSS der App meldet eine Schrift per @font-face an', () => {
    const verstoesse = cssDateien(SRC)
      .filter(([, inhalt]) => /@font-face/.test(inhalt.replace(/\/\*[\s\S]*?\*\//g, '')))
      .map(([pfad]) => pfad);
    expect(verstoesse).toEqual([]);
  });

  it('meldet jeden Schnitt sofort an und lädt alle, sobald der Browser Luft hat', () => {
    vi.useFakeTimers();
    const geladen: string[] = [];
    class Schnitt {
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors: FontFaceDescriptors,
      ) {}
      load() {
        geladen.push(`${this.family} ${this.descriptors.weight}`);
        return Promise.resolve(this);
      }
    }
    vi.stubGlobal('FontFace', Schnitt);
    const menge: Schnitt[] = [];

    meldeSchriftenAn({ add: (s: Schnitt) => menge.push(s) } as unknown as FontFaceSet);

    expect(menge.map((s) => [s.family, s.descriptors])).toEqual(
      SCHRIFTSCHNITTE.map((s) => [
        s.familie,
        { weight: String(s.gewicht), style: 'normal', display: 'swap' },
      ]),
    );
    expect(menge[0].source).toBe(
      `url(${JSON.stringify(SCHRIFTSCHNITTE[0].datei)}) format('woff2')`,
    );
    // Was der Bildschirm braucht, lädt der Browser selbst; der Rest kommt danach.
    expect(geladen).toHaveLength(0);
    vi.runAllTimers();
    expect(geladen).toHaveLength(SCHRIFTSCHNITTE.length);
  });
});
