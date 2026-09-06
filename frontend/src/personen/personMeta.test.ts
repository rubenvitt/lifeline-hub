import { describe, expect, it } from 'vitest';
import { SK_META, STATUS_META } from './personMeta';

describe('personMeta', () => {
  it('SK_META deckt alle Sichtungskategorien ab', () => {
    expect(Object.keys(SK_META).sort()).toEqual(
      ['sk1', 'sk2', 'sk3', 'sk4', 'tot', 'unverletzt'].sort(),
    );
    expect(SK_META.sk1).toEqual({ label: 'SK I', farbe: 'rot' });
    expect(SK_META.tot).toEqual({ label: 'tot', farbe: 'schwarz' });
  });

  it('STATUS_META deckt alle Personenstatus ab', () => {
    expect(Object.keys(STATUS_META).sort()).toEqual(
      ['abgemeldet', 'betroffen', 'erfasst', 'verstorben', 'vermisst'].sort(),
    );
    expect(STATUS_META.vermisst).toEqual({ label: 'vermisst', rolle: 'achtung' });
    for (const status of ['erfasst', 'betroffen', 'verstorben', 'abgemeldet'] as const) {
      expect(STATUS_META[status].rolle).toBe('neutral');
    }
  });
});
