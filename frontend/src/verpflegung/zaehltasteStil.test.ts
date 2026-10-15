import { describe, expect, it } from 'vitest';
import type { Dichte } from '../theme/dichte';
import { antdToken, farbenDunkel } from '../theme/tokens';
import { zaehltasteStil, zaehltastenAbstand } from './zaehltasteStil';

/** Aufgelöste Tokens je Stufe, wie sie der `ConfigProvider` setzt. */
function token(dichte: Dichte) {
  const t = antdToken(farbenDunkel, dichte)!;
  return { controlHeight: t.controlHeight!, marginSM: t.marginSM! };
}

describe('zaehltasteStil (LLH-1032, design.md D9)', () => {
  it('„+1“ ist in jeder Stufe mindestens 72 px hoch und breit', () => {
    expect(zaehltasteStil(token('kompakt'), 'plus1')).toMatchObject({ minHeight: 72, minWidth: 72 });
    expect(zaehltasteStil(token('komfortabel'), 'plus1')).toMatchObject({
      minHeight: 72,
      minWidth: 72,
    });
    expect(zaehltasteStil(token('handschuh'), 'plus1')).toMatchObject({
      minHeight: 72,
      minWidth: 72,
    });
  });

  it('die übrigen Zähltasten folgen der Staffel 30 / 48 / 72', () => {
    expect(zaehltasteStil(token('kompakt'), 'uebrige')).toMatchObject({
      minHeight: 30,
      minWidth: 30,
    });
    expect(zaehltasteStil(token('komfortabel'), 'uebrige')).toMatchObject({
      minHeight: 48,
      minWidth: 48,
    });
    expect(zaehltasteStil(token('handschuh'), 'uebrige')).toMatchObject({
      minHeight: 72,
      minWidth: 72,
    });
  });

  it('Abstand ist `marginSM`: 16 px in `handschuh`', () => {
    expect(zaehltastenAbstand(token('kompakt'))).toBe(7);
    expect(zaehltastenAbstand(token('komfortabel'))).toBe(11);
    expect(zaehltastenAbstand(token('handschuh'))).toBe(16);
  });
});
