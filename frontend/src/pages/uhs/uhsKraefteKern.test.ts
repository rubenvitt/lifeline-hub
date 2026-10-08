import { describe, expect, it } from 'vitest';
import type { UhsKraft } from '../../api/types';
import { freieEinheiten, kraftAuswahlText, zaehleQualifikationen } from './uhsKraefteKern';

function kraft(teil: Partial<UhsKraft> & { id: number }): UhsKraft {
  return { name: `Kraft ${teil.id}`, ist_adhoc: false, ...teil };
}

describe('zaehleQualifikationen', () => {
  it('zählt je Bezeichnung, eine Kraft mit zwei Qualifikationen in beiden', () => {
    const z = zaehleQualifikationen([
      kraft({ id: 1, funktion: 'Notarzt' }),
      kraft({ id: 2, funktion: 'Sanitäter' }),
      kraft({ id: 3, funktion: 'Rettungssanitäter, Sanitäter' }),
      kraft({ id: 4 }),
    ]);
    expect(z).toEqual([
      { bezeichnung: 'Sanitäter', anzahl: 2 },
      { bezeichnung: 'Notarzt', anzahl: 1 },
      { bezeichnung: 'Rettungssanitäter', anzahl: 1 },
    ]);
  });

  it('zählt dieselbe Bezeichnung an einer Kraft nur einmal und überspringt Leeres', () => {
    expect(zaehleQualifikationen([kraft({ id: 1, funktion: 'NotSan, , NotSan ' })])).toEqual([
      { bezeichnung: 'NotSan', anzahl: 1 },
    ]);
  });

  it('ohne Kräfte: keine Zahl', () => {
    expect(zaehleQualifikationen([])).toEqual([]);
  });
});

describe('freieEinheiten', () => {
  it('gruppiert Kräfte ohne UHS nach Einheit, ohne Einheit fällt heraus', () => {
    expect(
      freieEinheiten([
        kraft({ id: 1, einheit_id: 7, einheit: 'SEG 2' }),
        kraft({ id: 2, einheit_id: 3, einheit: 'SEG 1' }),
        kraft({ id: 3, einheit_id: 7, einheit: 'SEG 2' }),
        kraft({ id: 4 }),
      ]),
    ).toEqual([
      { id: 3, name: 'SEG 1', anzahl: 1 },
      { id: 7, name: 'SEG 2', anzahl: 2 },
    ]);
  });
});

describe('kraftAuswahlText', () => {
  it('nennt Name, Funktion und Einheit, soweit vorhanden', () => {
    expect(
      kraftAuswahlText(kraft({ id: 1, name: 'Anna', funktion: 'Notärztin', einheit: 'SEG 1' })),
    ).toBe('Anna · Notärztin · SEG 1');
    expect(kraftAuswahlText(kraft({ id: 2, name: 'Bernd' }))).toBe('Bernd');
  });
});
