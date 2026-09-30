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

  it('zählt eine Enkeleinheit nicht, wenn nur ihr Großvater in der Menge steht (LFH-550)', () => {
    // A → B → G; im Bereitstellungsraum stehen A und G, nicht B. A kumuliert G schon mit.
    const a = {
      id: 1,
      ueber_einheit_id: null,
      ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 6 },
    };
    const b = {
      id: 2,
      ueber_einheit_id: 1,
      ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 4 },
    };
    const g = {
      id: 3,
      ueber_einheit_id: 2,
      ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 1 },
    };
    expect(summiereStaerke([a, g], [a, b, g])).toEqual({
      fuehrer: 1,
      unterfuehrer: 2,
      mannschaft: 6,
    });
  });

  it('ein korrupter Zyklus zählt genau einmal, über die kleinste Kennung', () => {
    const s = { fuehrer: 1, unterfuehrer: 1, mannschaft: 1 };
    const x = { id: 7, ueber_einheit_id: 8, ist_kumuliert: s };
    const y = { id: 8, ueber_einheit_id: 7, ist_kumuliert: s };
    expect(summiereStaerke([y, x])).toEqual(s);
  });
});
