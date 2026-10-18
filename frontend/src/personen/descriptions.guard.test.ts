import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';

/**
 * Kein `Descriptions` unter `personen/` (LLH-1137, `frontend/src/personen/AGENTS.md`,
 * „Personen-Detail“): Personendaten stehen im `Datenraster`, leere Angaben in EINER Zeile
 * „Ohne Angabe: …“. Eine Strichspalte läse sich am Handy als Inhalt. Gelesen wird Quelltext ohne
 * Kommentare, Tests sind ausgenommen.
 */
const ORDNER = (() => {
  for (const kandidat of ['src/personen', 'frontend/src/personen']) {
    try {
      readdirSync(resolve(process.cwd(), kandidat));
      return resolve(process.cwd(), kandidat);
    } catch {
      // nächster Kandidat
    }
  }
  throw new Error(`personen/ nicht gefunden (cwd: ${process.cwd()})`);
})();

export function descriptionsBefunde(dateien: Record<string, string>): string[] {
  return Object.entries(dateien)
    .filter(([pfad]) => !/\.test\.[jt]sx?$/.test(pfad))
    .filter(([, inhalt]) => /\bDescriptions\b/.test(ohneKommentare(inhalt).join('\n')))
    .map(([pfad]) => pfad);
}

describe('Kein Descriptions unter personen/ (LLH-1137)', () => {
  it('findet in keiner Datei ein Descriptions', () => {
    const dateien: Record<string, string> = {};
    for (const name of readdirSync(ORDNER)) {
      if (/\.tsx?$/.test(name)) dateien[name] = readFileSync(join(ORDNER, name), 'utf8');
    }
    expect(descriptionsBefunde(dateien)).toEqual([]);
  });

  it('erkennt die verbotene Form (Selbstbeweis)', () => {
    expect(
      descriptionsBefunde({
        'x.tsx': "import { Descriptions } from 'antd';",
        'y.test.tsx': 'Descriptions',
      }),
    ).toEqual(['x.tsx']);
  });
});
