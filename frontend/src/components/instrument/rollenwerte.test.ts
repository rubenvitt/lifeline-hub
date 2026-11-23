import { describe, expect, it } from 'vitest';
import { farbenDunkel, farbenHell, schrift } from '../../theme/tokens';
import { istDunkel, monoStil, rollenwerte, schriftStil } from './rollenwerte';

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

  it('die Augenbraue kommt aus der Schriftskala: 11 px, 600, .08em, Versalien (LLH-2044)', () => {
    expect(schriftStil('augenbraue')).toEqual({
      fontFamily: schrift.text,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    });
  });

  it('Zahlenstufen laufen in Mono mit tabular-nums', () => {
    expect(schriftStil('datenwert')).toMatchObject({
      fontFamily: schrift.zahl,
      fontSize: 32,
      fontWeight: 500,
      fontVariantNumeric: 'tabular-nums',
    });
    expect(monoStil('monoFein')).toEqual({
      fontFamily: schrift.zahl,
      fontSize: 11,
      fontWeight: 400,
      fontVariantNumeric: 'tabular-nums',
    });
    // LLH-2046: meta steht in der Textschrift, behält aber gleich breite Ziffern.
    expect(schriftStil('meta')).toEqual({
      fontFamily: schrift.text,
      fontSize: 11,
      fontWeight: 400,
      fontVariantNumeric: 'tabular-nums',
    });
  });

  describe('monoStil nimmt eine Mono-Stufe (LLH-1972)', () => {
    it('liefert Größe und Gewicht der Stufe', () => {
      expect(monoStil('mono')).toEqual({
        fontFamily: schrift.zahl,
        fontSize: 13,
        fontWeight: 400,
        fontVariantNumeric: 'tabular-nums',
      });
      expect(monoStil('datenwertKlein').fontWeight).toBe(500);
    });

    it('das Gewicht lässt sich überschreiben', () => {
      expect(monoStil('monoKlein', 500)).toMatchObject({ fontSize: 12, fontWeight: 500 });
      expect(monoStil('datenwertGross', 400).fontWeight).toBe(400);
    });

    it('übernimmt die Sperrung der Datenwert-Stufen nicht — die Umstellung bleibt pixelgleich', () => {
      expect(monoStil('datenwertGross')).toEqual({
        fontFamily: schrift.zahl,
        fontSize: 40,
        fontWeight: 500,
        fontVariantNumeric: 'tabular-nums',
      });
    });

    it('nimmt eine Zahl aus einer Variablen mit Gewicht 400', () => {
      const ausDichte = 17;
      expect(monoStil(ausDichte)).toMatchObject({ fontSize: 17, fontWeight: 400 });
    });

    it('lehnt Text-Stufen am Typ ab', () => {
      // @ts-expect-error — `text` ist keine Mono-Stufe
      expect(monoStil('text').fontFamily).toBe(schrift.zahl);
    });
  });
});
