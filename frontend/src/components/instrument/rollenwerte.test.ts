import { describe, expect, it } from 'vitest';
import { farbenDunkel, farbenHell, schrift } from '../../theme/tokens';
import { istDunkel, rollenwerte, schriftGroesse, schriftStil, zahlStil } from './rollenwerte';

describe('rollenwerte', () => {
  it('erkennt den Modus an der Helligkeit der Basisfläche', () => {
    expect(istDunkel({ colorBgBase: '#000' })).toBe(true);
    expect(istDunkel({ colorBgBase: '#000000' })).toBe(true);
    expect(istDunkel({ colorBgBase: '#fff' })).toBe(false);
    expect(istDunkel({ colorBgBase: '#ffffff' })).toBe(false);
  });

  it('fällt bei einem fremden Wert auf Hell zurück, statt zu werfen', () => {
    expect(istDunkel({ colorBgBase: 'transparent' })).toBe(false);
    expect(istDunkel({ colorBgBase: '' })).toBe(false);
  });

  it('liefert die Palette des erkannten Modus — keine Kopie, dieselbe Referenz', () => {
    expect(rollenwerte({ colorBgBase: '#000' })).toBe(farbenDunkel);
    expect(rollenwerte({ colorBgBase: '#fff' })).toBe(farbenHell);
  });

  it('die Augenbraue kommt aus der Schriftskala: Stufe fein, 600, .08em, Versalien', () => {
    expect(schriftStil('augenbraue')).toEqual({
      fontFamily: schrift.text,
      fontSize: 'var(--lfh-groesse-fein)',
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      fontVariantNumeric: 'tabular-nums',
    });
  });

  it('die Größe ist die CSS-Variable der Stufe, keine Zahl (wächst mit der Dichte)', () => {
    expect(schriftGroesse('klein')).toBe('var(--lfh-groesse-klein)');
    expect(schriftStil('seitentitel').fontSize).toBe('var(--lfh-groesse-titel)');
  });

  it('meta steht in der Textschrift mit gleich breiten Ziffern (LLH-1777)', () => {
    expect(schriftStil('meta')).toMatchObject({
      fontFamily: schrift.text,
      fontSize: 'var(--lfh-groesse-klein)',
      fontVariantNumeric: 'tabular-nums',
    });
  });

  it('Zahlenstufen laufen in Mono mit tabular-nums', () => {
    expect(schriftStil('datenwert')).toMatchObject({
      fontFamily: schrift.zahl,
      fontSize: 'var(--lfh-groesse-gross)',
      fontWeight: 500,
      fontVariantNumeric: 'tabular-nums',
    });
    expect(zahlStil('fein')).toEqual({
      fontFamily: schrift.zahl,
      fontSize: 'var(--lfh-groesse-fein)',
      fontWeight: 400,
      fontVariantNumeric: 'tabular-nums',
    });
    expect(zahlStil('text', 500).fontWeight).toBe(500);
  });
});
