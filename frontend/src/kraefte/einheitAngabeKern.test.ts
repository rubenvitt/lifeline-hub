import { describe, expect, it } from 'vitest';
import type { Einheit } from '../api/types';
import { buildEinheitOptions } from './einheitAngabeKern';

const eh = (id: number, name: string, ueber: number | null, extra: Partial<Einheit> = {}) =>
  ({ id, name, ueber_einheit_id: ueber, abschnitt_id: null, ...extra }) as Einheit;

describe('buildEinheitOptions', () => {
  it('folgt dem Kräftebaum mit Pfad und lässt aufgelöste Einheiten aus', () => {
    const optionen = buildEinheitOptions(
      [
        eh(1, 'Zug 1', null),
        eh(2, 'Staffel A', 1),
        eh(3, 'Alter Trupp', null, { aufgeloest_at: '2026-10-13 15:00:00' }),
        eh(4, 'Rettungsstaffel', null),
      ],
      [],
    );
    expect(optionen.map((o) => [o.id, o.pfad, o.tiefe])).toEqual([
      [1, 'Zug 1', 0],
      [2, 'Zug 1 › Staffel A', 1],
      [4, 'Rettungsstaffel', 0],
    ]);
  });
});
