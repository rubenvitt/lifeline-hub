import { describe, expect, it } from 'vitest';
import { dichten } from '../theme/tokens';
import { EINHEITEN_SCHRIFT, einheitenSprungAufbau } from './einheitenSprung';

/**
 * Die Zeile „Als Einheit übernommen: …“ in der schmalen Board-Spalte (LLH-1410). Mit dem
 * Kennungs-Boden stand jeder Link als unteilbarer 30-px-Block auf einer eigenen Zeile. Böden als
 * LITERALE, sonst prüfte der Test das Token gegen sich selbst; antds `lineHeight` ist 22/14.
 */
describe('einheitenSprungAufbau', () => {
  const ANTD_ZEILE = 22 / 14;
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    controlHeightSM: dichten[stufe].kleineZeilenhoehe,
    lineHeight: ANTD_ZEILE,
  });

  it('schreibt die Zeile in 13 px', () => {
    expect(EINHEITEN_SCHRIFT).toBe(13);
  });

  it('kompakt: die Links fließen im Satz und tragen keinen Steuerboden', () => {
    const aufbau = einheitenSprungAufbau(tokenFuer('kompakt'));
    expect(aufbau.art).toBe('fliessend');
    if (aufbau.art !== 'fliessend') return;
    expect(aufbau.link.display).toBe('inline');
    expect(aufbau.link.minHeight).toBeUndefined();
  });

  it('kompakt: die senkrechte Polsterung hebt die Trefffläche auf den Boden 24, ohne die Zeile zu heben', () => {
    const aufbau = einheitenSprungAufbau(tokenFuer('kompakt'));
    if (aufbau.art !== 'fliessend') throw new Error('kompakt fließt');
    const polster = aufbau.link.paddingBlock as number;
    // 13 × 22/14 ≈ 20,43 px Zeile; 2 × Polster ergänzt auf 24.
    expect(13 * ANTD_ZEILE + 2 * polster).toBeCloseTo(24, 5);
    // Höchstens 2 px je Seite: mehr griffe in die Nachbarzeile.
    expect(polster).toBeLessThanOrEqual(2);
  });

  it('komfortabel und Handschuh: die Links behalten ihren Boden und stehen in Reihen', () => {
    expect(einheitenSprungAufbau(tokenFuer('komfortabel')).art).toBe('gereiht');
    expect(einheitenSprungAufbau(tokenFuer('handschuh')).art).toBe('gereiht');
  });

  it('nie negative Polsterung, wenn die Zeile schon den Boden erreicht', () => {
    const aufbau = einheitenSprungAufbau({ controlHeight: 30, controlHeightSM: 16, lineHeight: 2 });
    if (aufbau.art !== 'fliessend') throw new Error('fließt');
    expect(aufbau.link.paddingBlock).toBe(0);
  });
});
