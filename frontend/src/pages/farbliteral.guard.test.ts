import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Kein `#888` in `pages/` (LFH-347): Farbwerte kommen aus `theme.useToken()` /
 * `theme/statusFarben.ts`; das Literal verlor im Dunkelmodus Kontrast. Ein Gate gegen jedes
 * Hex-Literal wäre rot geboren (`flaechenFarbe`, Zeichenfarben der Lagekarte u. a. tragen
 * begründete Werte als Daten).
 *
 * Blindfleck bis LFH-704: `#888` allein ließ jede andere Farbe am Element durch, etwa antds altes
 * Gold `#faad14` am Standardstern der Kartenansicht. Deshalb gilt zusätzlich: keine Hex-Farbe in
 * einer Stil-Eigenschaft eines Elements (`color`, `background`, `borderColor`, `fill`, `stroke`
 * …). Farben als Daten (`farbe: '#…'`) prüft das bewusst nicht.
 */
function dateien(verz: string): string[] {
  return readdirSync(verz).flatMap((n) => {
    const p = join(verz, n);
    if (statSync(p).isDirectory()) return dateien(p);
    return /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}

const STIL_HEX =
  /\b(?:color|background|backgroundColor|borderColor|border(?:Top|Right|Bottom|Left)?Color|outlineColor|fill|stroke)\s*:\s*['"`]#[0-9a-fA-F]{3,8}\b/;

describe('Farbliteral-Gate', () => {
  it('kennt kein #888 in pages/', () => {
    const treffer = dateien(join(__dirname))
      .filter((p) => !p.endsWith('farbliteral.guard.test.ts'))
      .filter((p) => readFileSync(p, 'utf8').includes('#888'));
    expect(treffer).toEqual([]);
  });

  it('kennt keine Hex-Farbe in einer Stil-Eigenschaft unter pages/ (LFH-704)', () => {
    const treffer = dateien(join(__dirname))
      .filter((p) => p.endsWith('.tsx') && !/\.test\.tsx$/.test(p))
      .filter((p) => STIL_HEX.test(readFileSync(p, 'utf8')));
    expect(treffer).toEqual([]);
  });
});
