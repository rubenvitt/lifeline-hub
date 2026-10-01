import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Eigenheiten des Organigramms im Druck (LFH-626, D6). Die Regeln des Gerüsts prüft
 * `components/organigramm/haengenderBaumPrint.test.ts` (LFH-625 D4); hier bleibt nur, was allein
 * das Organigramm trägt.
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HIER, 'organigrammPrint.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

describe('organigrammPrint.css', () => {
  it('steht ganz unter @media print', () => {
    expect(css.trim().startsWith('@media print')).toBe(true);
  });

  it('blendet die Bedienung aus', () => {
    expect(css).toMatch(/\.organigramm-no-print\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('trägt keine Regel des Gerüsts und keine Mechanik von druck.css ein zweites Mal', () => {
    expect(css).not.toContain('org-');
    expect(css).not.toMatch(/visibility\s*:/);
    expect(css).not.toMatch(/@page/);
    expect(css).not.toContain('druckwurzel');
  });
});
