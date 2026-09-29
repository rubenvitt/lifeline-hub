import { describe, expect, it } from 'vitest';
import {
  GRUPPEN_REIHENFOLGE,
  GRUPPE_MERKBAR,
  GRUPPE_NUR_ORDNUNG,
  type BefehlGruppe,
} from './typen';

/**
 * Was der TYP nicht sehen kann: eine DUBLETTE in `GRUPPEN_REIHENFOLGE` ist typkorrekt, würde die
 * Gruppe aber zweimal rendern, und `aria-activedescendant` zeigte auf zwei Knoten. Rein und
 * exportiert, damit der Selbstbeweis an einer erfundenen Liste möglich ist.
 */
export function dubletten(reihenfolge: readonly string[]): string[] {
  const gesehen = new Set<string>();
  const doppelt = new Set<string>();
  for (const eintrag of reihenfolge) {
    if (gesehen.has(eintrag)) doppelt.add(eintrag);
    gesehen.add(eintrag);
  }
  return [...doppelt];
}

describe('Palette-Gruppen', () => {
  it('führt keine Gruppe zweimal in der Reihenfolge', () => {
    expect(
      dubletten(GRUPPEN_REIHENFOLGE),
      'Doppelter Eintrag in GRUPPEN_REIHENFOLGE: die Gruppe rendert zweimal und ' +
        'aria-activedescendant wird über doppelte cmd-<id> mehrdeutig.',
    ).toEqual([]);
  });

  it('erkennt eine Dublette tatsächlich (Selbst-Beweis)', () => {
    // Ein Guard, der nur per Konstruktion grün ist, sagt nichts aus.
    expect(dubletten(['a', 'b', 'a'])).toEqual(['a']);
    // Jede doppelte Gruppe wird genau einmal gemeldet, auch bei drei Vorkommen.
    expect(dubletten(['a', 'b', 'a', 'a'])).toEqual(['a']);
    expect(dubletten(['a', 'b', 'c'])).toEqual([]);
  });
});

/**
 * `tsc` erzwingt, dass jede Gruppe in beiden Gruppen-Records steht, nicht aber, dass die Zeilen
 * zueinander passen.
 */
describe('Gedächtnis-Gruppe „ausgefuehrt"', () => {
  it('steht bei leerer Suche zuoberst', () => {
    // Die Startansicht rendert AUSSCHLIESSLICH über dieses Tupel; „zuoberst“ ist Index 0.
    expect(GRUPPEN_REIHENFOLGE[0]).toBe('ausgefuehrt');
  });

  /**
   * Eine Gruppe, die merkbar UND Ordnungskopie ist, merkte sich ihre eigenen Kopien
   * (`ausgefuehrt:ausgefuehrt:…`), die beim nächsten Aufbau nicht mehr auflösen.
   */
  it('ist keine Gruppe zugleich merkbar und Ordnungskopie', () => {
    const beides = (Object.keys(GRUPPE_MERKBAR) as BefehlGruppe[]).filter(
      (g) => GRUPPE_MERKBAR[g] && GRUPPE_NUR_ORDNUNG[g],
    );
    expect(beides).toEqual([]);
  });

  /** Die Kopien-Gruppen sind benannt, nicht abgeleitet; sonst wäre die Zeile darüber trivial
   *  grün. */
  it('führt genau die beiden Gedächtnisgruppen als Ordnungskopie', () => {
    const kopien = (Object.keys(GRUPPE_NUR_ORDNUNG) as BefehlGruppe[]).filter(
      (g) => GRUPPE_NUR_ORDNUNG[g],
    );
    expect(kopien.sort()).toEqual(['ausgefuehrt', 'zuletzt']);
  });
});
