import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Druckeinstiege heißen nach ihrer Wirkung (LLH-1836, Spec `druck-dokumente`, „Druckeinstiege
 * heißen nach ihrer Wirkung“; `druck/AGENTS.md`, „Wortlaut und Platz“): „Drucken / als PDF“ öffnet
 * den Druckdialog, „Druckansicht“ eine Druckseite. Beide Wörter stehen nur in
 * `components/druck/useDruckNebenwege.ts` (und am Knopf `DruckKnopf`); eine Seite nimmt
 * `DRUCKEN`, `DRUCKANSICHT`, `druckansichtVon` oder `druckansichtNebenweg`.
 *
 * Geprüft an der Quelle ohne Kommentare: die alten Wörter („Einsatzbericht drucken“, „Registrierliste
 * drucken“, ein Knopf „Drucken“ ohne Zusatz) und die Wörter als Literal außerhalb des Bausteins.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Diese Dateien tragen die Wörter selbst. */
const BAUSTEIN = new Set([
  'components/druck/useDruckNebenwege.ts',
  'components/druck/DruckKnopf.tsx',
]);

function quellen(verzeichnis: string): string[] {
  const aus: string[] = [];
  for (const name of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, name);
    if (statSync(pfad).isDirectory()) aus.push(...quellen(pfad));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts'))
      aus.push(pfad);
  }
  return aus;
}

function ohneKommentare(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const DATEIEN = quellen(SRC).map((pfad) => ({
  datei: relative(SRC, pfad).split('\\').join('/'),
  code: ohneKommentare(readFileSync(pfad, 'utf8')),
}));

const VERBOTEN: { name: string; muster: RegExp }[] = [
  { name: '„Einsatzbericht drucken“', muster: /Einsatzbericht drucken/ },
  { name: '„Registrierliste drucken“', muster: /Registrierliste drucken/ },
  { name: 'Knopf „Drucken“ ohne Zusatz', muster: />\s*Drucken\s*</ },
  { name: 'Eintrag „Drucken“ ohne Zusatz', muster: /label: '(?:Drucken|Druckansicht)'/ },
  { name: '„Drucken / als PDF“ als Literal', muster: /['"`>]\s*Drucken \/ als PDF/ },
  { name: '„Druckansicht“ als Knopftext', muster: />\s*Druckansicht\s*</ },
];

describe('Wortlaut der Druckeinstiege (LLH-1836)', () => {
  it('liest die Quellen (Selbsttest gegen eine leere Liste)', () => {
    expect(DATEIEN.length).toBeGreaterThan(500);
    expect(DATEIEN.some((d) => d.datei === 'pages/EtbPage.tsx')).toBe(true);
  });

  it.each(VERBOTEN.map((v) => [v.name, v] as const))('kein %s außerhalb des Bausteins', (_, v) => {
    const treffer = DATEIEN.filter((d) => !BAUSTEIN.has(d.datei) && v.muster.test(d.code)).map(
      (d) => d.datei,
    );
    expect(treffer).toEqual([]);
  });
});
