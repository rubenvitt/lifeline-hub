import { describe, expect, it } from 'vitest';
import type { Einheit } from '../../api/types';
import { collectNachfahren } from './einheitAnsichtKern';

const einheit = (id: number, ueber: number | null) =>
  ({ id, ueber_einheit_id: ueber }) as unknown as Einheit;

describe('collectNachfahren', () => {
  it('nimmt die Einheit selbst und eine Kette darunter', () => {
    const bestand = [einheit(1, null), einheit(2, 1), einheit(3, 2), einheit(4, null)];
    expect([...collectNachfahren(bestand, 1)].sort()).toEqual([1, 2, 3]);
  });

  it('folgt jeder Verzweigung, nicht den Geschwistern darüber', () => {
    const bestand = [
      einheit(1, null),
      einheit(2, 1),
      einheit(3, 1),
      einheit(4, 3),
      einheit(5, null),
    ];
    expect([...collectNachfahren(bestand, 1)].sort()).toEqual([1, 2, 3, 4]);
    expect([...collectNachfahren(bestand, 3)].sort()).toEqual([3, 4]);
  });

  it('bricht an einem Kreis im Bestand nicht', () => {
    const bestand = [einheit(1, 3), einheit(2, 1), einheit(3, 2)];
    expect([...collectNachfahren(bestand, 1)].sort()).toEqual([1, 2, 3]);
  });
});
