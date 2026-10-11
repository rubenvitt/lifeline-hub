import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { erzeugeZeichenWerte, ZIEL } from '../../scripts/zeichen-werte.mjs';

/**
 * Wächter der Werteliste für den Server (LFH-836, design.md D3).
 *
 * Der Rust-Prüfer für `freies_zeichen.zeichen_spec` liest `src/freies_zeichen/zeichen_werte.json`
 * per `include_str!`. Die Datei entsteht aus der installierten `@einsatzzeichen`-Bibliothek; ist
 * sie veraltet, lehnte der Server Werte ab, die der Picker anbietet (oder nähme gestrichene an).
 * Schlägt der Fall fehl: `mise exec -- pnpm -C frontend zeichen-werte` und die Datei mitcommitten.
 */

const hier = dirname(fileURLToPath(import.meta.url));
const frontend = join(hier, '..', '..');
const repo = join(frontend, '..');
const werteliste = join(repo, 'src', 'freies_zeichen', 'zeichen_werte.json');

type Feld = { form: string; werte?: string[]; schluessel?: string[] };
type Art = { felder: Record<string, Feld>; pflicht: string[] };
type Werteliste = { spec: Art; freestanding: Record<string, Art> };

/** Je Art und Feld die Werte, die nur auf einer Seite stehen — für eine lesbare Meldung. */
function abweichungen(eingecheckt: Werteliste, erzeugt: Werteliste): string[] {
  const arten = (w: Werteliste): [string, Art][] => [
    ['spec', w.spec],
    ...Object.entries(w.freestanding).map(([k, a]): [string, Art] => [`freestanding.${k}`, a]),
  ];
  const alt = new Map(arten(eingecheckt));
  const befunde: string[] = [];
  for (const [name, art] of arten(erzeugt)) {
    const vorher = alt.get(name);
    if (!vorher) {
      befunde.push(`${name}: Art fehlt`);
      continue;
    }
    for (const [feld, eintrag] of Object.entries(art.felder)) {
      const da = new Set([
        ...(vorher.felder[feld]?.werte ?? []),
        ...(vorher.felder[feld]?.schluessel ?? []),
      ]);
      const fehlt = [...(eintrag.werte ?? []), ...(eintrag.schluessel ?? [])].filter(
        (w) => !da.has(w),
      );
      if (!vorher.felder[feld]) befunde.push(`${name}.${feld}: Feld fehlt`);
      else if (fehlt.length > 0) befunde.push(`${name}.${feld}: fehlt ${fehlt.join(', ')}`);
    }
  }
  return befunde;
}

describe('Werteliste der Zeichenbeschreibung (src/freies_zeichen/zeichen_werte.json)', () => {
  it('liegt dort, wo der Erzeuger schreibt', () => {
    expect(ZIEL).toBe(werteliste);
  });

  it('entspricht der installierten Bibliothek', async () => {
    const erzeugt = await erzeugeZeichenWerte();
    let eingecheckt = '';
    try {
      eingecheckt = readFileSync(werteliste, 'utf8');
    } catch {
      // Fehlt die Datei, meldet der Vergleich unten das.
    }
    if (eingecheckt !== erzeugt && eingecheckt !== '') {
      const befunde = abweichungen(JSON.parse(eingecheckt), JSON.parse(erzeugt));
      expect(befunde, 'Werte der Bibliothek fehlen in der Werteliste').toEqual([]);
    }
    expect(eingecheckt, 'Werteliste veraltet: pnpm -C frontend zeichen-werte').toBe(erzeugt);
  });
});
