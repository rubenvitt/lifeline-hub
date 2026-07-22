import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

/**
 * CHARAKTERISIERUNGSTEST (LFH-307): pinnt die Prefix-Match-Semantik des Dienstfilter-Trios
 * (`personal` / `fahrzeuge` / `material`) gegen den Ist-Stand, VOR der Migration auf `globalKeys`.
 *
 * Diese drei Prefixe sind der riskanteste Teil der Migration, weil als einzige ein ZWEITES
 * Key-Element mit Bedeutung mitläuft. Zwei Eigenschaften müssen die Migration überleben:
 *
 *  1. Der BARE Prefix invalidiert beide Filter-Fächer (`['personal']` trifft `['personal','alle']`
 *     und `['personal','im-dienst']`). Genau darauf verlassen sich die Mutationen in
 *     `stammdaten/*` — ein argumentloser Accessor muss also weiterhin den baren Prefix liefern
 *     und nicht etwa einen Default-Filter.
 *  2. Die Fächer sind GETRENNT: ein Invalidate auf `['personal','alle']` lässt `'im-dienst'` in
 *     Ruhe. Fielen sie zusammen, lägen zwei Komponenten mit verschiedenen Filtern auf demselben
 *     Cache-Fach — wer zuerst mountet, gewinnt, der andere zeigt fremde Daten, ohne dass ein
 *     Request oder das DOM auffiele.
 *
 * `new QueryClient()` statt `neuerQueryClient()`: siehe Begründung in `invalidiereKarte.test.ts`
 * (gcTime 0 räumt unbeobachtete Einträge beim ersten await weg → Assertions trivial grün).
 */

const TRIO = ['personal', 'fahrzeuge', 'material'] as const;

describe('Query-Key-Prefix-Match: Dienstfilter-Trio (LFH-307-Charakterisierung)', () => {
  it.each(TRIO)('%s: der bare Prefix invalidiert beide Filter-Fächer', (prefix) => {
    const qc = new QueryClient();
    qc.setQueryData([prefix, 'alle'], { wert: 1 });
    qc.setQueryData([prefix, 'im-dienst'], { wert: 1 });

    expect(qc.getQueryState([prefix, 'alle'])?.isInvalidated).toBe(false);
    expect(qc.getQueryState([prefix, 'im-dienst'])?.isInvalidated).toBe(false);

    qc.invalidateQueries({ queryKey: [prefix] });

    expect(qc.getQueryState([prefix, 'alle'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState([prefix, 'im-dienst'])?.isInvalidated).toBe(true);
  });

  it.each(TRIO)('%s: die Filter-Fächer sind getrennt (Negativ-Anker)', (prefix) => {
    const qc = new QueryClient();
    qc.setQueryData([prefix, 'alle'], { wert: 1 });
    qc.setQueryData([prefix, 'im-dienst'], { wert: 1 });

    qc.invalidateQueries({ queryKey: [prefix, 'alle'] });

    expect(qc.getQueryState([prefix, 'alle'])?.isInvalidated).toBe(true);
    expect(
      qc.getQueryState([prefix, 'im-dienst'])?.isInvalidated,
      `${prefix}: 'im-dienst' darf von einem 'alle'-Invalidate NICHT getroffen werden`,
    ).toBe(false);
  });

  it('sprechgruppen: heute existiert nur der Filterwert "alle"', () => {
    // Kein bare-Invalidate im Bestand — deshalb bekommt sprechgruppen in der Registry auch nur
    // `sprechgruppenAlle()` und keinen Prefix-Accessor. Dieser Test hält fest, warum.
    const qc = new QueryClient();
    qc.setQueryData(['sprechgruppen', 'alle'], { wert: 1 });
    qc.invalidateQueries({ queryKey: ['sprechgruppen', 'alle'] });
    expect(qc.getQueryState(['sprechgruppen', 'alle'])?.isInvalidated).toBe(true);
  });
});
