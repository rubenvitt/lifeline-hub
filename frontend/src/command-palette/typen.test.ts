import { describe, expect, it } from 'vitest';
import { GRUPPEN_REIHENFOLGE, GRUPPE_MERKBAR, GRUPPE_NUR_ORDNUNG, type BefehlGruppe } from './typen';

/**
 * Was der TYP nicht sehen kann (LFH-391 · A2).
 *
 * Seit `BefehlGruppe` aus `GRUPPEN_REIHENFOLGE` abgeleitet ist, kann eine Gruppe nicht
 * mehr existieren, ohne in der Reihenfolge zu stehen — das erzwingt `tsc`, nicht dieser
 * Test. Eine DUBLETTE dagegen ist typkorrekt: `(typeof ['a','b','a'])[number]` ist
 * dieselbe Union wie ohne die Wiederholung. Gerendert wird die Gruppe dann zweimal,
 * jede Option trägt ihre `cmd-<id>` doppelt — womit `aria-activedescendant` auf zwei
 * Knoten zeigt. Genau die Mehrdeutigkeit, gegen die `befehle.ts` die `zuletzt:`-Ids
 * schon einmal mit eigenem Präfix versehen hat.
 *
 * Reine, exportierte Hilfe nach dem Muster von `basenameKollisionen`
 * (`test/dateinamen.guard.test.ts`): nur so ist der Selbst-Beweis an einer erfundenen
 * Liste möglich — die Aussage über den Bestand ist heute grün und für sich allein
 * nicht rot-fähig.
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
 * Was die beiden exhaustiven Gruppen-Records nicht selbst behaupten können (LFH-391 · D).
 *
 * `tsc` erzwingt, dass JEDE Gruppe in beiden Records eine Zeile hat (TS2741) — nicht aber,
 * dass die beiden Zeilen zueinander passen.
 */
describe('Gedächtnis-Gruppe „ausgefuehrt"', () => {
  it('steht bei leerer Suche zuoberst', () => {
    // Die Startansicht rendert AUSSCHLIESSLICH über dieses Tupel; „zuoberst" ist damit
    // Index 0 und keine Meinung.
    expect(GRUPPEN_REIHENFOLGE[0]).toBe('ausgefuehrt');
  });

  /**
   * Eine Gruppe, die zugleich merkbar UND eine reine Ordnungskopie ist, merkte sich ihre
   * eigenen Kopien: aus `ausgefuehrt:nav:profil` würde `ausgefuehrt:ausgefuehrt:nav:profil`,
   * das beim nächsten Aufbau gegen nichts mehr auflöst. Das Gedächtnis vergässe genau die
   * Befehle, die am häufigsten benutzt werden.
   */
  it('ist keine Gruppe zugleich merkbar und Ordnungskopie', () => {
    const beides = (Object.keys(GRUPPE_MERKBAR) as BefehlGruppe[]).filter(
      (g) => GRUPPE_MERKBAR[g] && GRUPPE_NUR_ORDNUNG[g],
    );
    expect(beides).toEqual([]);
  });

  /** Die zwei Kopien-Gruppen sind benannt, nicht abgeleitet — sonst wäre die Zeile darüber
   *  trivial grün, weil beide Records dieselbe Aussage träfen. */
  it('führt genau die beiden Gedächtnisgruppen als Ordnungskopie', () => {
    const kopien = (Object.keys(GRUPPE_NUR_ORDNUNG) as BefehlGruppe[]).filter(
      (g) => GRUPPE_NUR_ORDNUNG[g],
    );
    expect(kopien.sort()).toEqual(['ausgefuehrt', 'zuletzt']);
  });
});
