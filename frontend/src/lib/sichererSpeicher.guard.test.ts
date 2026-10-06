import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';

/**
 * Guard (LFH-942, design.md D5): `localStorage` steht nur in `lib/sichererSpeicher.ts`.
 *
 * Auf einem gehärteten Rechner ist `localStorage` `null` oder wirft schon beim Zugriff, ein
 * volles Kontingent wirft beim Schreiben. Ein ungeschützter Zugriff im Render ließ die Seite
 * weiß (ThemeModeProvider). Der Helfer fängt jeden Wurf ab; dieser Guard hält jeden anderen
 * Zugriff fern.
 *
 * Gesucht wird das Wort `localStorage` in Code ohne Kommentare und ohne Inhalt einfacher
 * String-Literale, damit auch `window.localStorage` und `Object.keys(localStorage)` auffallen,
 * die Ortsangaben in `GERAETESPEICHER` aber nicht. Tests und `src/test/` sind ausgenommen, sie
 * legen Speicher gerade zum Prüfen an oder sperren ihn.
 */

const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const HEIM = '/src/lib/sichererSpeicher.ts';

const ohneStrings = (zeile: string) =>
  zeile.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');

export function speicherStellen(quellen: Record<string, string>): string[] {
  const stellen: string[] = [];
  for (const [pfad, inhalt] of Object.entries(quellen)) {
    if (pfad === HEIM) continue;
    if (/\.test\.tsx?$/.test(pfad) || pfad.startsWith('/src/test/')) continue;
    ohneKommentare(inhalt).forEach((zeile, i) => {
      if (/\blocalStorage\b/.test(ohneStrings(zeile))) {
        stellen.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
      }
    });
  }
  return stellen;
}

describe('Browserspeicher-Guard (LFH-942): localStorage nur über lib/sichererSpeicher', () => {
  it('findet keinen direkten Zugriff', () => {
    // Sicherung gegen ein kaputtes Glob-Muster: ein leerer Scan wäre still grün.
    expect(Object.keys(dateien).length).toBeGreaterThan(100);
    expect(dateien[HEIM], 'der Helfer liegt, wo der Guard ihn erwartet').toContain('localStorage');

    const stellen = speicherStellen(dateien);
    expect(
      stellen,
      `localStorage ist auf gehärteten Rechnern null oder wirft. Bitte sicherLesen, ` +
        `sicherSchreiben, sicherEntfernen oder sicherSchluessel aus lib/sichererSpeicher ` +
        `nehmen:\n${stellen.join('\n')}`,
    ).toEqual([]);
  });

  it('erkennt Aufruf, window-Zugriff und Schlüsselliste, aber keinen Kommentar und keinen String (Selbst-Beweis)', () => {
    expect(
      speicherStellen({
        '/src/a/lesen.ts': "const v = localStorage.getItem('k');",
        '/src/a/fenster.ts': "window.localStorage.setItem('k', 'v');",
        '/src/a/schluessel.ts': 'const ks = Object.keys(localStorage);',
        '/src/a/optional.ts': "globalThis.localStorage?.removeItem('k');",
        '/src/a/kommentar.ts': "// localStorage.getItem('k')\n/* localStorage */ const x = 1;",
        '/src/a/string.ts': "const ort = 'localStorage lfh:nav:eingeklappt';",
        '/src/a/lesen.test.ts': "localStorage.getItem('k');",
        '/src/test/setup.ts': 'localStorage.clear();',
        [HEIM]: "globalThis.localStorage.getItem('k');",
      }),
    ).toEqual([
      "/src/a/lesen.ts:1  const v = localStorage.getItem('k');",
      "/src/a/fenster.ts:1  window.localStorage.setItem('k', 'v');",
      '/src/a/schluessel.ts:1  const ks = Object.keys(localStorage);',
      "/src/a/optional.ts:1  globalThis.localStorage?.removeItem('k');",
    ]);
  });
});
