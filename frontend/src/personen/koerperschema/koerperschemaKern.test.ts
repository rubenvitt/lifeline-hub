import { describe, expect, it } from 'vitest';
import type { Verletzung } from '../../api/types';
import { figurVon, nummeriere, regionName } from './koerperschemaKern';

/** Kern des Körperschemas (LLH-1120, Spec `koerperschema`). */

function verletzung(id: number, aufgehoben = false): Verletzung {
  return {
    id,
    einsatz_id: 1,
    person_id: 1,
    ansicht: 'vorn',
    region: 'kopf',
    art: 'wunde_blutung',
    zeitpunkt_at: '2026-10-18 10:00:00',
    erfasst_at: '2026-10-18 10:00:00',
    erfasst_von: 1,
    aufgehoben_at: aufgehoben ? '2026-10-18 10:05:00' : null,
  };
}

describe('figurVon — Figur nach Geschlecht', () => {
  it.each([
    ['maennlich', 'maennlich'],
    ['weiblich', 'weiblich'],
    ['divers', 'neutral'],
    ['unbekannt', 'neutral'],
    [null, 'neutral'],
    [undefined, 'neutral'],
  ] as const)('%s → %s', (geschlecht, figur) => {
    expect(figurVon(geschlecht)).toBe(figur);
  });
});

describe('regionName — Region, Seite und Ansicht', () => {
  it('nennt „Unterarm links, vorn“', () => {
    expect(regionName('vorn', 'unterarm_l')).toBe('Unterarm links, vorn');
    expect(regionName('hinten', 'fuss_r')).toBe('Fuß rechts, hinten');
    expect(regionName('hinten', 'wirbelsaeule')).toBe('Wirbelsäule, hinten');
  });
});

describe('nummeriere — feste Nummer nach Erfassungsfolge', () => {
  it('zählt nach der Kennung, nicht nach der Lieferfolge', () => {
    const n = nummeriere([verletzung(9), verletzung(3), verletzung(5)]);
    expect(n.map((e) => [e.nummer, e.verletzung.id])).toEqual([
      [1, 3],
      [2, 5],
      [3, 9],
    ]);
  });

  it('eine aufgehobene behält ihre Nummer, die übrigen zählen nicht neu', () => {
    const vorher = nummeriere([verletzung(1), verletzung(2), verletzung(3)]);
    const nachher = nummeriere([verletzung(1), verletzung(2, true), verletzung(3)]);
    expect(nachher.map((e) => e.nummer)).toEqual(vorher.map((e) => e.nummer));
    expect(nachher.filter((e) => !e.verletzung.aufgehoben_at).map((e) => e.nummer)).toEqual([1, 3]);
  });
});
