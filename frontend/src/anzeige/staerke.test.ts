import { describe, expect, it } from 'vitest';
import { summiereStaerke } from './staerke';

describe('summiereStaerke', () => {
  it('liefert null bei leerer Liste — „keine Einheit" ist nicht „0/0/0"', () => {
    expect(summiereStaerke([])).toBeNull();
  });

  it('summiert je Achse über ist_kumuliert', () => {
    expect(
      summiereStaerke([
        { id: 1, ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 } },
        { id: 2, ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 5 } },
      ]),
    ).toEqual({ fuehrer: 1, unterfuehrer: 3, mannschaft: 8 });
  });

  it('zählt eine Untereinheit nicht zusätzlich, wenn ihre Einheit in der Menge steht (LFH-550)', () => {
    // A kumuliert 1/2/5 (enthält B mit 0/1/3); beide stehen im selben Bereitstellungsraum.
    const a = {
      id: 1,
      ueber_einheit_id: null,
      ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 5 },
    };
    const b = {
      id: 2,
      ueber_einheit_id: 1,
      ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 3 },
    };
    expect(summiereStaerke([a, b])).toEqual({ fuehrer: 1, unterfuehrer: 2, mannschaft: 5 });
    expect(summiereStaerke([b, a])).toEqual({ fuehrer: 1, unterfuehrer: 2, mannschaft: 5 });
    // Ohne ihre Einheit ist die Untereinheit eine Wurzel der Menge und zählt selbst.
    expect(summiereStaerke([b])).toEqual({ fuehrer: 0, unterfuehrer: 1, mannschaft: 3 });
  });
});
