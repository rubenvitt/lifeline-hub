import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';
import { quellwurzel } from '../test/ratsche';

/**
 * Wächter „Ungespeichertes ist sichtbar“ (LLH-1829, `frontend/AGENTS.md`, „Formularseiten“).
 *
 * Wer eine Speichern-Leiste baut (`useSpeicherLeiste`), speichert über `SpeicherKnopf` und stellt
 * den `AenderungsstandProvider` ins Formular: sonst stünde dort wieder ein immer aktiver Knopf ohne
 * Stand, und geänderte Felder trügen keinen Punkt.
 *
 * Grenze: geprüft wird je Datei, nicht je Leiste. Eine Datei mit zwei Leisten und nur einem
 * Knopf fiele nicht auf.
 */

const SRC = quellwurzel('SpeicherKnopf-Wächter');

function quelldateien(verzeichnis: string): string[] {
  const dateien: string[] = [];
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) dateien.push(...quelldateien(pfad));
    else if (/\.tsx$/.test(eintrag.name) && !/\.test\.tsx$/.test(eintrag.name)) dateien.push(pfad);
  }
  return dateien;
}

function mitLeiste(): { datei: string; text: string }[] {
  return quelldateien(SRC)
    .map((pfad) => ({
      datei: relative(SRC, pfad),
      text: ohneKommentare(readFileSync(pfad, 'utf8')).join('\n'),
    }))
    .filter(({ text }) => /\buseSpeicherLeiste\(/.test(text));
}

describe('SpeicherKnopf-Wächter (LLH-1829)', () => {
  it('findet die Formularseiten überhaupt', () => {
    expect(mitLeiste().length).toBeGreaterThanOrEqual(14);
  });

  it('jede Datei mit Speichern-Leiste nutzt SpeicherKnopf und AenderungsstandProvider', () => {
    const ohne = mitLeiste()
      .filter(({ text }) => !/<SpeicherKnopf\b/.test(text) || !/<AenderungsstandProvider\b/.test(text))
      .map(({ datei }) => datei);
    expect(ohne).toEqual([]);
  });
});
