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

  // LFH-893 4.3, gemessen in e2e `fernmeldeskizze-druck.spec.ts`: Druckkopf (45 mm) und Lücken
  // (89 mm) über der Skizze ließen auf A3 quer (267 mm Nutzhöhe bei 15 mm Rand) 122 mm, auf A4 quer
  // (180 mm) 35 mm; die Skizze rutschte ganz auf Seite 2. Die Lücken folgen im Druck der Skizze,
  // die Höhe der Skizze lässt dem Druckkopf Platz.
  it('Skizze direkt nach dem Druckkopf, die Lücken danach (ganze Skizze auf Seite 1)', () => {
    for (const f of ['a3', 'a4'] as const) {
      const k = `.${skizzenDruckKlasse(f)}`;
      expect(koerper(k)).toMatch(/display:\s*flex/);
      expect(koerper(k)).toMatch(/flex-direction:\s*column/);
      expect(css).toMatch(new RegExp(`\\${k} > \\[data-lfh='paneel'\\][^{]*\\{\\s*order:\\s*1`));
    }
  });

  it('die Höhe der Skizze lässt dem Druckkopf (45 mm) Platz auf der Seite', () => {
    const mm = (f: 'a3' | 'a4') =>
      Number(
        /max-height:\s*(\d+)mm/.exec(
          koerper(`.${skizzenDruckKlasse(f)} .lfh-skizze-flaeche svg`) ?? '',
        )?.[1],
      );
    // Nutzhöhe quer: A3 297 − 30, A4 210 − 30; Kopf 45 mm, Abstände 8 mm.
    expect(mm('a3')).toBeLessThanOrEqual(267 - 45 - 8);
    expect(mm('a4')).toBeLessThanOrEqual(180 - 45 - 8);
    expect(mm('a4')).toBeGreaterThanOrEqual(100);
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

  // Prüfliste O4 (Kriterium 11): die Fläche lässt die Meldung im Druck weg (`druck`, über
  // `beforeprint`); die Regel deckt Druckwege ohne `beforeprint` (`page.pdf`, `emulateMedia`).
  it('blendet Meldungen am Element aus, auch ohne `beforeprint`', () => {
    expect(koerper(".lfh-skizze-flaeche [data-teil='meldung']")).toMatch(
      /display:\s*none\s*!important/,
    );
  });

  it('die Komponente bindet die Datei ein', () => {
    const bild = readFileSync(join(HIER, '..', 'FernmeldeskizzeBild.tsx'), 'utf8');
    expect(bild).toContain("import './skizze/skizzeDruck.css';");
  });
});
