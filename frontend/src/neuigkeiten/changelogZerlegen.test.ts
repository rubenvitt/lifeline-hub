import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// Liegt außerhalb von `src/`, damit `tsc -b` in `vite.config.ts` nichts danebenschreibt.
import { zerlegeChangelog } from '../../scripts/changelog-zerlegen.mjs';

const KOPF = (version: string, datum = '2026-10-11') =>
  `## [${version}](https://github.com/x/y/compare/a...b) (${datum})\n`;

describe('zerlegeChangelog', () => {
  it('trennt Einträge an den Versionsüberschriften, neueste zuerst bleibt die Reihenfolge', () => {
    const text = `${KOPF('1.0.0-alpha.106')}\n### Verwaltung\n\n- Eins\n\n${KOPF('1.0.0-alpha.105')}\nText zwei\n`;

    const eintraege = zerlegeChangelog(text);

    expect(eintraege.map((e) => e.version)).toEqual(['1.0.0-alpha.106', '1.0.0-alpha.105']);
    expect(eintraege[0].text).toContain('### Verwaltung');
    expect(eintraege[0].text).toContain('- Eins');
    expect(eintraege[0].text).not.toContain('Text zwei');
    expect(eintraege[1].text).toBe('Text zwei');
  });

  it('liest Versionslink und Datum', () => {
    const [eintrag] = zerlegeChangelog(KOPF('1.0.0-alpha.106', '2026-10-11') + 'x\n');

    expect(eintrag.link).toBe('https://github.com/x/y/compare/a...b');
    expect(eintrag.datum).toBe('2026-10-11');
  });

  it('ordnet den Kanal aus dem Versionssuffix zu: alpha, beta, sonst stabil', () => {
    const text = [
      KOPF('1.0.0-alpha.106'),
      'a\n',
      KOPF('1.0.0-beta.2'),
      'b\n',
      KOPF('1.0.0'),
      'c\n',
    ].join('');

    expect(zerlegeChangelog(text).map((e) => e.kanal)).toEqual(['alpha', 'beta', 'stabil']);
  });

  it('behält einen Eintrag ohne Datum und zeigt ihn mit der Version', () => {
    const [eintrag] = zerlegeChangelog('## [1.0.0-alpha.7](https://example.org/v7)\nText\n');

    expect(eintrag.version).toBe('1.0.0-alpha.7');
    expect(eintrag.datum).toBeNull();
    expect(eintrag.text).toBe('Text');
  });

  it('zerlegt keine Überschrift innerhalb eines Codeblocks', () => {
    const text = `${KOPF('1.0.0-alpha.9')}\n\`\`\`\n## [kein-eintrag](x) (2026-01-01)\n\`\`\`\n`;

    const eintraege = zerlegeChangelog(text);

    expect(eintraege).toHaveLength(1);
    expect(eintraege[0].text).toContain('## [kein-eintrag](x) (2026-01-01)');
  });

  it('behält eine Version, die doppelt in der Datei steht, in der Reihenfolge der Datei', () => {
    const text = `${KOPF('1.0.0-alpha.55')}erster\n${KOPF('1.0.0-alpha.55')}zweiter\n`;

    const eintraege = zerlegeChangelog(text);

    expect(eintraege.map((e) => e.text)).toEqual(['erster', 'zweiter']);
  });

  it('wirft bei einer Versionsüberschrift, die sich nicht lesen lässt', () => {
    const text = `${KOPF('1.0.0-alpha.1')}x\n## Versehentlich geschrieben\ny\n`;

    expect(() => zerlegeChangelog(text)).toThrow(/Versehentlich geschrieben/);
  });

  it('liest die echte CHANGELOG.md des Repos ohne Fehler und mit Alpha-Einträgen', () => {
    const pfad = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'CHANGELOG.md');
    const eintraege = zerlegeChangelog(readFileSync(pfad, 'utf8'));

    expect(eintraege.length).toBeGreaterThan(100);
    expect(eintraege.some((e) => e.kanal === 'alpha')).toBe(true);
  });
});
