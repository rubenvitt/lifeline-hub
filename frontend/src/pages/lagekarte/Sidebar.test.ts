import { describe, it, expect } from 'vitest';
import { ortVorschauExclude } from './Sidebar';

describe('ortVorschauExclude', () => {
  it('einsatzort → einsatzort:<einsatzId> (echte ID, nicht 0)', () => {
    expect(ortVorschauExclude({ typ: 'einsatzort', id: 0 }, 42)).toBe('einsatzort:42');
  });

  it('fuehrung → personal:<id>', () => {
    expect(ortVorschauExclude({ typ: 'fuehrung', id: 7 }, 1)).toBe('personal:7');
  });

  it('uhs → uhs:<id>', () => {
    expect(ortVorschauExclude({ typ: 'uhs', id: 3 }, 1)).toBe('uhs:3');
  });

  it('schaden → schaden:<id>', () => {
    expect(ortVorschauExclude({ typ: 'schaden', id: 5 }, 1)).toBe('schaden:5');
  });

  it('einheit → einheit:<id>', () => {
    expect(ortVorschauExclude({ typ: 'einheit', id: 9 }, 1)).toBe('einheit:9');
  });

  it('fahrzeug → fahrzeug:<id>', () => {
    expect(ortVorschauExclude({ typ: 'fahrzeug', id: 2 }, 1)).toBe('fahrzeug:2');
  });

  it('null → undefined', () => {
    expect(ortVorschauExclude(null, 1)).toBeUndefined();
  });
});
