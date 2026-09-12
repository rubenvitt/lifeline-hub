import { describe, expect, it } from 'vitest';
import { summiereStaerke } from './staerke';

describe('summiereStaerke', () => {
  it('liefert null bei leerer Liste — „keine Einheit" ist nicht „0/0/0"', () => {
    expect(summiereStaerke([])).toBeNull();
  });

  it('summiert je Achse über ist_kumuliert', () => {
    expect(
      summiereStaerke([
        { ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 } },
        { ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 5 } },
      ]),
    ).toEqual({ fuehrer: 1, unterfuehrer: 3, mannschaft: 8 });
  });
});
