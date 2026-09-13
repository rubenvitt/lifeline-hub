import { describe, expect, it } from 'vitest';
import { dichten } from '../theme/tokens';
import { stabZeilenzielStil } from './zeilenziel';

/**
 * Ein `<a>` erbt KEINE Steuerhöhe (LFH-396: 17 px in jeder Stufe gemessen). Geprüft wird der
 * Inline-Stil der reinen Funktion über die Dichtestufen — `test/utils.tsx` montiert ein nacktes
 * `ConfigProvider`, jsdom rechnet kein Layout. Die Böden stehen als LITERALE da; aus dem Token
 * zurückgelesen prüften sie den Token gegen sich selbst.
 */
describe('stabZeilenzielStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingSM: dichten[stufe].abstand.sm,
    padding: dichten[stufe].abstand.md,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(stabZeilenzielStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(stabZeilenzielStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(stabZeilenzielStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const h = (['kompakt', 'komfortabel', 'handschuh'] as const).map(
      (s) => stabZeilenzielStil(tokenFuer(s)).minHeight as number,
    );
    expect(h[0]).toBeLessThan(h[1]);
    expect(h[1]).toBeLessThan(h[2]);
  });

  it('trägt die ZWEITE Angabe (Polsterung) dichteabhängig mit (LFH-365)', () => {
    expect(stabZeilenzielStil(tokenFuer('kompakt')).padding).toBe('7px 11px');
    expect(stabZeilenzielStil(tokenFuer('handschuh')).padding).toBe('16px 26px');
  });

  it('steht inline in der Textzeile', () => {
    expect(stabZeilenzielStil(tokenFuer('kompakt')).display).toBe('inline-flex');
  });
});
