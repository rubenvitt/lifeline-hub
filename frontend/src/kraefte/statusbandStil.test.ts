import { describe, expect, it } from 'vitest';
import { farbenDunkel, farbenHell } from '../theme/tokens';
import { bandQuadratFarbe, bandSpalten, bandZahlFarbe } from './statusbandStil';
import type { AbBreitePunkt } from '../components/useViewport';

const ab =
  (bis: AbBreitePunkt | null) =>
  (punkt: AbBreitePunkt): boolean => {
    const folge: AbBreitePunkt[] = ['sm', 'md', 'lg', 'xl', 'xxl'];
    return bis != null && folge.indexOf(punkt) <= folge.indexOf(bis);
  };

describe('bandSpalten', () => {
  it('6 ab xl, 3 ab md, 2 darunter', () => {
    expect(bandSpalten(ab('xxl'))).toBe(6);
    expect(bandSpalten(ab('xl'))).toBe(6);
    expect(bandSpalten(ab('lg'))).toBe(3);
    expect(bandSpalten(ab('md'))).toBe(3);
    expect(bandSpalten(ab('sm'))).toBe(2);
    expect(bandSpalten(ab(null))).toBe(2);
  });
});

describe('bandZahlFarbe', () => {
  it('nachts steht die Zahl in der Tonfarbe (Entwurf S6)', () => {
    expect(bandZahlFarbe(farbenDunkel, 'normal', true)).toBe(farbenDunkel.normalText);
    expect(bandZahlFarbe(farbenDunkel, 'bedien', true)).toBe(farbenDunkel.bedienText);
    expect(bandZahlFarbe(farbenDunkel, 'achtung', true)).toBe(farbenDunkel.achtung);
    expect(bandZahlFarbe(farbenDunkel, 'alarm', true)).toBe(farbenDunkel.alarm);
    expect(bandZahlFarbe(farbenDunkel, 'neutral', true)).toBe(farbenDunkel.text2);
  });

  it('tags tragen achtung/alarm den 7:1-Boden nicht — die Zahl nimmt text', () => {
    expect(bandZahlFarbe(farbenHell, 'achtung', false)).toBe(farbenHell.text);
    expect(bandZahlFarbe(farbenHell, 'alarm', false)).toBe(farbenHell.text);
    // Gegenprobe: die Töne mit eigener Textrolle bleiben getönt.
    expect(bandZahlFarbe(farbenHell, 'normal', false)).toBe(farbenHell.normalText);
    expect(bandZahlFarbe(farbenHell, 'bedien', false)).toBe(farbenHell.bedienText);
  });
});

describe('bandQuadratFarbe', () => {
  it('trägt den Ton in beiden Modi, neutral in schwach', () => {
    expect(bandQuadratFarbe(farbenHell, 'achtung')).toBe(farbenHell.achtung);
    expect(bandQuadratFarbe(farbenDunkel, 'alarm')).toBe(farbenDunkel.alarm);
    expect(bandQuadratFarbe(farbenDunkel, 'neutral')).toBe(farbenDunkel.schwach);
  });
});
