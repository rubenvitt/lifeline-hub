import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { skizzenDruckKlasse } from './druckformat';

/**
 * Die Eigenheiten der Fernmeldeskizze im Druck (LFH-893 D13), geprüft an der CSS-Quelle (jsdom
 * kennt kein `@media print`). Ob A3 quer im Browser greift, zeigt das Blatt (e2e/Handprüfung).
 */
const HIER = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HIER, 'skizzeDruck.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function koerper(kopf: string): string | undefined {
  const i = css.indexOf(`${kopf} {`);
  if (i < 0) return undefined;
  const auf = css.indexOf('{', i);
  return css.slice(auf + 1, css.indexOf('}', auf)).trim();
}

describe('skizzeDruck.css', () => {
  it('steht ganz unter @media print', () => {
    expect(css.trim().startsWith('@media print')).toBe(true);
  });

  it('A3 und A4 quer als benannte Seiten, die Klasse aus `skizzenDruckKlasse` wählt sie', () => {
    expect(koerper('@page fernmeldeskizze-a3')).toMatch(/size:\s*A3 landscape/);
    expect(koerper('@page fernmeldeskizze-a4')).toMatch(/size:\s*A4 landscape/);
    expect(koerper(`.${skizzenDruckKlasse('a3')}`)).toMatch(/page:\s*fernmeldeskizze-a3/);
    expect(koerper(`.${skizzenDruckKlasse('a4')}`)).toMatch(/page:\s*fernmeldeskizze-a4/);
  });

  it('die unbenannte @page (Rand, Seitenzahl) bleibt bei druck.css', () => {
    expect(css).not.toMatch(/@page\s*\{/);
    expect(css).not.toMatch(/margin\s*:/);
  });

  it('blendet die Bedienung aus und trägt keine Mechanik ein zweites Mal', () => {
    expect(koerper('.lfh-skizze-bedienung')).toMatch(/display:\s*none\s*!important/);
    expect(css).not.toMatch(/visibility\s*:/);
    expect(css).not.toMatch(/position:\s*absolute/);
    expect(css).not.toContain('druckwurzel');
  });

  it('die Komponente bindet die Datei ein', () => {
    const bild = readFileSync(join(HIER, '..', 'FernmeldeskizzeBild.tsx'), 'utf8');
    expect(bild).toContain("import './skizze/skizzeDruck.css';");
  });
});
