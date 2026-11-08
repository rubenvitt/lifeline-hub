import { describe, expect, it } from 'vitest';
import { dichten } from '../theme/tokens';
import { linkZeilenzielStil } from './linkZeilenziel';

/**
 * Ein `<a>` erbt KEINE Steuerhöhe. Geprüft wird der Inline-Stil der reinen Funktion über die
 * Dichtestufen (jsdom rechnet kein Layout). Die Böden stehen als LITERALE da, sonst prüften sie
 * den Token gegen sich selbst.
 */
describe('linkZeilenzielStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingSM: dichten[stufe].abstand.sm,
    padding: dichten[stufe].abstand.md,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(linkZeilenzielStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(linkZeilenzielStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(linkZeilenzielStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const h = (['kompakt', 'komfortabel', 'handschuh'] as const).map(
      (s) => linkZeilenzielStil(tokenFuer(s)).minHeight as number,
    );
    expect(h[0]).toBeLessThan(h[1]);
    expect(h[1]).toBeLessThan(h[2]);
  });

  it('trägt die ZWEITE Angabe (Polsterung) dichteabhängig mit (LFH-365)', () => {
    expect(linkZeilenzielStil(tokenFuer('kompakt')).padding).toBe('7px 11px');
    expect(linkZeilenzielStil(tokenFuer('handschuh')).padding).toBe('16px 26px');
  });

  it('steht inline in der Textzeile', () => {
    expect(linkZeilenzielStil(tokenFuer('kompakt')).display).toBe('inline-flex');
  });
});
