import { describe, it, expect } from 'vitest';
import { palettenZeilenStil, vorschauZielStil } from './zeilenStil';
import { dichten } from '../theme/tokens';

/**
 * Trefflächenboden der Palettenzeile. Geprüft wird die REINE Funktion: `test/utils.tsx` montiert
 * ein nacktes `ConfigProvider` ohne unser Theme, und jsdom rechnet kein Layout. Die Böden stehen
 * als LITERALE da, aus dem Token gelesen prüften sie sich selbst.
 */
describe('palettenZeilenStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingXS: dichten[stufe].abstand.xs,
    paddingSM: dichten[stufe].abstand.sm,
    marginSM: dichten[stufe].abstand.sm,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(palettenZeilenStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(palettenZeilenStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(palettenZeilenStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  /**
   * ZWEI Angaben: die Polsterung allein trägt den Boden nicht (Handschuh rund 54 statt 72 px), muss
   * aber mitziehen, sonst klebt der Text an der Kante.
   */
  it('trägt neben der Höhe eine mitziehende Polsterung', () => {
    expect(palettenZeilenStil(tokenFuer('kompakt')).padding).toBe('3px 7px');
    expect(palettenZeilenStil(tokenFuer('handschuh')).padding).toBe('7px 16px');
  });

  /**
   * Der Wert ZIEHT MIT: ein aus einer Konstante gelesener Stil bestünde die Literal-Prüfung oben,
   * die Ungleichheit über die Stufen nicht.
   */
  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const stufen = (['kompakt', 'komfortabel', 'handschuh'] as const).map((s) =>
      palettenZeilenStil(tokenFuer(s)),
    );
    expect(stufen[0].minHeight).toBeLessThan(stufen[1].minHeight);
    expect(stufen[1].minHeight).toBeLessThan(stufen[2].minHeight);
    expect(stufen[0].gap).toBeLessThan(stufen[1].gap);
    expect(stufen[1].gap).toBeLessThan(stufen[2].gap);
  });
});

/**
 * Das Tippziel „Vorschau“: ein handgebautes Bedienziel mit denselben ZWEI Angaben, hier in beiden
 * Richtungen, weil es ein Quadrat am Rand ist.
 */
describe('vorschauZielStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingXS: dichten[stufe].abstand.xs,
    paddingSM: dichten[stufe].abstand.sm,
    colorBorderSecondary: '#123456',
  });

  it('trägt den Boden aus controlHeight in Höhe UND Breite — 30 / 48 / 72 px', () => {
    for (const [stufe, boden] of [
      ['kompakt', 30],
      ['komfortabel', 48],
      ['handschuh', 72],
    ] as const) {
      const stil = vorschauZielStil(tokenFuer(stufe));
      expect(stil.minHeight, stufe).toBe(boden);
      expect(stil.minWidth, stufe).toBe(boden);
    }
  });

  it('trägt neben dem Boden eine mitziehende Polsterung', () => {
    expect(vorschauZielStil(tokenFuer('kompakt')).padding).toBe('3px 7px');
    expect(vorschauZielStil(tokenFuer('handschuh')).padding).toBe('7px 16px');
  });

  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const [k, m, h] = (['kompakt', 'komfortabel', 'handschuh'] as const).map((s) =>
      vorschauZielStil(tokenFuer(s)),
    );
    expect(k.minWidth).toBeLessThan(m.minWidth);
    expect(m.minWidth).toBeLessThan(h.minWidth);
  });

  /**
   * Die Treffertrennung: die Zeile ist content-box (Boden + 2 × paddingXS), das Ziel zieht sich um
   * genau die Zeilenpolsterung heraus und endet bündig an der Kante. Sonst bliebe ein Streifen, in
   * dem ein verfehlter Tipp den Datensatz öffnete.
   */
  it('sitzt bündig an der rechten Zeilenkante und füllt die volle Zeilenhöhe', () => {
    for (const stufe of ['kompakt', 'handschuh'] as const) {
      const t = tokenFuer(stufe);
      const stil = vorschauZielStil(t);
      // Gegen die Polsterung der ZEILE gerechnet: ändert `palettenZeilenStil` sie, bricht dieser Test
      // mit.
      const [oben, rechts] = palettenZeilenStil({ ...t, marginSM: t.paddingSM })
        .padding.split(' ')
        .map((w) => Number.parseFloat(w));
      expect(stil.marginInlineEnd, stufe).toBe(-rechts);
      expect(stil.marginBlock, stufe).toBe(-oben);
      expect(stil.alignSelf, stufe).toBe('stretch');
      expect(stil.boxSizing, stufe).toBe('border-box');
    }
  });

  it('trennt sich sichtbar von der Zeile', () => {
    expect(vorschauZielStil(tokenFuer('kompakt')).borderInlineStart).toBe('1px solid #123456');
  });
});
