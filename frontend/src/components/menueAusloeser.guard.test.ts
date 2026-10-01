/**
 * Menüauslöser-Guard (LFH-683): ein Dreipunkt-Menü entsteht nur in `components/MenueAusloeser.tsx`.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Elf Stellen bauten den Auslöser gebündelter Datensatz-Aktionen (LFH-365) von Hand nach, und die
 * Kopien liefen auseinander: ohne `autoFocus`, ohne Zeilenkennung im Namen, mit Rückfrage-Blase im
 * Menü, mit und ohne Riegel gegen das Portal-Aufsteigen. Der Baustein trägt die Mechanik einmal;
 * dieser Guard hält ihn als einzigen Ort.
 *
 * ── Was er zählt ────────────────────────────────────────────────────────────────
 * Eine Quelldatei, die `<Dropdown` UND das Dreipunkt-Zeichen enthält. Grob, aber ohne Lücke für
 * den Fall, der wiederkäme: ein `Dropdown` mit `IkonePunkteSenkrecht` am Auslöser.
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────────
 *   • ein Dropdown, dessen Zeichen aus einer anderen Datei kommt (als Prop gereicht);
 *   • ein Menü mit einem anderen Zeichen am Auslöser.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const BAUSTEIN = '/src/components/MenueAusloeser.tsx';

/**
 * Ausnahmen MIT Grund am Eintrag. Ein Eintrag ohne Fund ist tot und färbt den Guard rot.
 */
const AUSNAHMEN: Record<string, string> = {
  '/src/pages/lagekarte/AnsichtSwitcher.tsx':
    'Werkzeugknopf der Kartenansicht (umrandet, mit Ladezustand), kein Datensatz: die Bündelregel ' +
    'gilt für Aktionen an Zeilen, Karten und Detailköpfen.',
};

function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (/\.tsx$/.test(eintrag.name) && !/\.test\.tsx$/.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/** Baut die Datei einen eigenen Dreipunkt-Auslöser? */
function bautDreipunktMenue(quelle: string): boolean {
  return /<Dropdown\b/.test(quelle) && /\bIkonePunkteSenkrecht\b/.test(quelle);
}

describe('Menüauslöser-Guard (LFH-683)', () => {
  const quellen = lieseQuellen(SRC);
  const funde = Object.entries(quellen)
    .filter(([pfad, inhalt]) => pfad !== BAUSTEIN && bautDreipunktMenue(inhalt))
    .map(([pfad]) => pfad);

  it('kein Dreipunkt-Menü außerhalb des Bausteins', () => {
    expect(funde.filter((pfad) => !(pfad in AUSNAHMEN))).toEqual([]);
  });

  it('jede Ausnahme ist noch belegt', () => {
    expect(Object.keys(AUSNAHMEN).filter((pfad) => !funde.includes(pfad))).toEqual([]);
  });

  it('der Baustein selbst ist das, was der Guard sucht', () => {
    // Gegenprobe: stimmte das Suchmuster nicht mehr (Ikone umbenannt), wären die Tests oben trivial
    // grün.
    expect(bautDreipunktMenue(quellen[BAUSTEIN])).toBe(true);
  });

  it('erkennt einen Nachbau und lässt einen Aufrufer des Bausteins in Ruhe', () => {
    expect(
      bautDreipunktMenue(
        `<Dropdown menu={{ items }}><Button icon={<IkonePunkteSenkrecht />} /></Dropdown>`,
      ),
    ).toBe(true);
    expect(
      bautDreipunktMenue(`<MenueAusloeser eintraege={e} zugaenglicherName="A" onWahl={w} />`),
    ).toBe(false);
  });
});
