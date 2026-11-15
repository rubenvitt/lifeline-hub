import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Schrift-Reset (LLH-1772): Ohne Familie am `body` rechnet alles außerhalb von antds `.ant-app`
 * auf die Vorgabe des Browsers (Times New Roman), etwa Portale an `document.body` wie das
 * Eingangsband. Native Bedienelemente erben die Schrift im Browser gar nicht und fallen auf
 * Arial bzw. die Systemschrift zurück. Beides regelt `index.css` einmal für die ganze App; ein
 * lokales `font: 'inherit'` je Stelle ist dafür nicht nötig.
 */
describe('Schrift-Reset in index.css', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

  it('html und body tragen die Textschrift', () => {
    const regel = /(?:^|\n)html,\s*body\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(regel).toMatch(/font-family:\s*var\(--lfh-schrift-text\);/);
  });

  it('native Bedienelemente erben die ganze Schrift', () => {
    const regel =
      /(?:^|\n)button,\s*input,\s*textarea,\s*select\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(regel).toMatch(/font:\s*inherit;/);
  });
});
