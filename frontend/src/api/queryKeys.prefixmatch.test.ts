import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

/**
 * CHARAKTERISIERUNGSTEST der Prefix-Match-Semantik des Dienstfilter-Trios
 * (`personal` / `fahrzeuge` / `material`):
 *
 *  1. Der BARE Prefix invalidiert beide Filter-Fächer; darauf verlassen sich die Mutationen in
 *     `stammdaten/*`. Ein argumentloser Accessor muss den baren Prefix liefern, keinen
 *     Default-Filter.
 *  2. Die Fächer sind GETRENNT: fielen sie zusammen, zeigte eine Komponente still die Daten
 *     eines anderen Filters.
 *
 * `new QueryClient()` statt `neuerQueryClient()`: dessen `gcTime: 0` räumt unbeobachtete
 * Einträge beim ersten await weg, die Assertions würden trivial grün.
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
    // Kein bare-Invalidate im Bestand, deshalb hat sprechgruppen nur `sprechgruppenAlle()`.
    const qc = new QueryClient();
    qc.setQueryData(['sprechgruppen', 'alle'], { wert: 1 });
    qc.invalidateQueries({ queryKey: ['sprechgruppen', 'alle'] });
    expect(qc.getQueryState(['sprechgruppen', 'alle'])?.isInvalidated).toBe(true);
  });
});
