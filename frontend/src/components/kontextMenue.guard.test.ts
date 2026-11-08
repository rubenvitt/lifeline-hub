/**
 * Kontextmenü-Guard (LLH-1596, `openspec/changes/archive/2026-11-08-om9oxxiq-kontextmenue-baustein/design.md` D8): ein
 * Kontextmenü entsteht nur über `components/useKontextMenue.ts`.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Rechtsklick, langer Druck und Tasten haben Fallen, die jede Kopie neu träfe: das native Menü von
 * Android beim Halten, das Abheben nach dem langen Druck als Klick, das nachgeschobene
 * `contextmenu` der Taste, das Browsermenü auf Link, Feld und Markierung. Der Baustein trägt sie
 * einmal; dieser Guard hält ihn als einzigen Ort.
 *
 * ── Was er zählt ────────────────────────────────────────────────────────────────
 * Eine Quelldatei (ohne Tests), die `onContextMenu` enthält. Wer den Baustein nutzt, spreizt dessen
 * Handler (`{...ausloeser(zeile)}`) und schreibt das Wort nicht selbst.
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────────
 *   • `addEventListener('contextmenu', …)` und `map.on('contextmenu', …)` (Lagekarte, bewusst beim
 *     maplibre-Ereignis, LFH-776);
 *   • einen eigenen Langdruck-Zeitgeber ohne `onContextMenu`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const BAUSTEIN = '/src/components/useKontextMenue.ts';

/** Ausnahmen MIT Grund am Eintrag. Ein Eintrag ohne Fund ist tot und färbt den Guard rot. */
const AUSNAHMEN: Record<string, string> = {
  '/src/geraet/LagemonitorPage.tsx':
    'Unterdrückt das Browsermenü auf dem Wandbildschirm nur, öffnet kein eigenes Menü.',
  '/src/stab/skizze/SkizzenFlaeche.tsx':
    'Unterdrückt das Browsermenü der Übersicht (dort ist kein Element Ziel); die Elemente nutzen ' +
    'den Baustein.',
};

function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (/\.tsx?$/.test(eintrag.name) && !/\.test\.tsx?$/.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/** Baut die Datei eine eigene Kontextmenü-Mechanik? */
function bautKontextMechanik(quelle: string): boolean {
  return /\bonContextMenu\b/.test(quelle);
}

describe('Kontextmenü-Guard (LLH-1596)', () => {
  const quellen = lieseQuellen(SRC);
  const funde = Object.entries(quellen)
    .filter(([pfad, inhalt]) => pfad !== BAUSTEIN && bautKontextMechanik(inhalt))
    .map(([pfad]) => pfad);

  it('kein `onContextMenu` außerhalb des Bausteins', () => {
    expect(funde.filter((pfad) => !(pfad in AUSNAHMEN))).toEqual([]);
  });

  it('jede Ausnahme ist noch belegt', () => {
    expect(Object.keys(AUSNAHMEN).filter((pfad) => !funde.includes(pfad))).toEqual([]);
  });

  it('der Baustein selbst ist das, was der Guard sucht', () => {
    // Gegenprobe: stimmte das Suchmuster nicht mehr, wären die Tests oben trivial grün.
    expect(bautKontextMechanik(quellen[BAUSTEIN])).toBe(true);
  });

  it('erkennt einen Nachbau und lässt einen Aufrufer des Bausteins in Ruhe', () => {
    expect(bautKontextMechanik(`<li onContextMenu={(e) => e.preventDefault()} />`)).toBe(true);
    expect(bautKontextMechanik(`<li {...ausloeser(zeile)} />`)).toBe(false);
  });
});
