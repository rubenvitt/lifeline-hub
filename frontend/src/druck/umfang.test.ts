import { describe, expect, it } from 'vitest';
import { umfangText } from './umfang';

describe('umfangText (LFH-727)', () => {
  it('kennt Einzahl, Mehrzahl und Tausender', () => {
    expect(umfangText(0, 'Person', 'Personen')).toBe('0 Personen');
    expect(umfangText(1, 'Person', 'Personen')).toBe('1 Person');
    expect(umfangText(1200, 'Tier', 'Tiere')).toBe('1 200 Tiere');
  });
});
