import { describe, expect, it } from 'vitest';
import { dichten, farbenDunkel } from '../../theme/tokens';
import { rasterStil, zeilenzielStil } from './ueberblickStil';

const tokenFuer = (stufe: keyof typeof dichten) => ({
  controlHeight: dichten[stufe].zeilenhoehe,
  paddingSM: dichten[stufe].abstand.sm,
  padding: dichten[stufe].abstand.md,
});

describe('zeilenzielStil — handgebautes Bedienziel (LFH-365: zwei Angaben)', () => {
  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px (Literale)', () => {
    expect(zeilenzielStil(farbenDunkel, tokenFuer('kompakt')).minHeight).toBe(30);
    expect(zeilenzielStil(farbenDunkel, tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(zeilenzielStil(farbenDunkel, tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('die Polsterung zieht über die Stufen mit, statt festzukleben', () => {
    const k = zeilenzielStil(farbenDunkel, tokenFuer('kompakt'));
    const h = zeilenzielStil(farbenDunkel, tokenFuer('handschuh'));
    expect(k.paddingBlock).toBeLessThan(h.paddingBlock as number);
    expect(k.paddingInline).toBeLessThan(h.paddingInline as number);
  });
});

describe('rasterStil', () => {
  it('zwei Spalten 1.35fr / 1fr ab lg, darunter gestapelt', () => {
    expect(rasterStil(true, 20).gridTemplateColumns).toBe('minmax(0, 1.35fr) minmax(0, 1fr)');
    expect(rasterStil(false, 20).gridTemplateColumns).toBe('minmax(0, 1fr)');
  });
});
