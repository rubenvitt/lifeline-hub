// frontend/src/command-palette/zeilenStil.test.ts
import { describe, it, expect } from 'vitest';
import { palettenZeilenStil, vorschauZielStil } from './zeilenStil';
import { dichten } from '../theme/tokens';

/**
 * Trefflächenboden der Palettenzeile (LFH-365, Nacharbeit zu LFH-335).
 *
 * Geprüft wird die REINE Funktion, nicht ein gerenderter Wert: `test/utils.tsx` montiert ein
 * nacktes `ConfigProvider` OHNE unser Theme — eine gerenderte Höhe belegte antd-Vorgaben statt
 * der Staffel —, und jsdom rechnet ohnehin kein Layout.
 *
 * Die Böden stehen als LITERALE da. Aus dem Token zurückgelesen prüften sie den Token gegen
 * sich selbst und blieben grün, egal welche Zahl dort steht.
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
   * ZWEI Angaben, nicht eine (Konvention aus LFH-365): die Polsterung allein trägt den Boden
   * nicht — sie kommt im Handschuh-Betrieb auf grob 54 px gegen die geforderten 72. Sie muss
   * trotzdem da sein und ebenfalls mitziehen, sonst klebt der Text an der Kante.
   */
  it('trägt neben der Höhe eine mitziehende Polsterung', () => {
    expect(palettenZeilenStil(tokenFuer('kompakt')).padding).toBe('3px 7px');
    expect(palettenZeilenStil(tokenFuer('handschuh')).padding).toBe('7px 16px');
  });

  /**
   * Die eigentliche Aussage: der Wert ZIEHT MIT. Ein festgenagelter Stil bestünde die
   * Literal-Prüfung oben nicht, ein aus einer Konstante gelesener aber schon — die
   * Ungleichheit über die Stufen ist das, was eine Verwechslung der Quelle auffliegen ließe.
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
 * Das Tippziel „Vorschau" an einer Palettenzeile (LFH-665).
 *
 * Seit LFH-645 öffnet → eine Lese-Vorschau, aber nur per Tastatur. Auf dem Führungs-Tablet
 * öffnete ein Tipp die Zeile, an die Vorschau kam niemand heran. Das Ziel ist ein
 * handgebautes Bedienziel und schuldet deshalb dieselben ZWEI Angaben wie die Zeile — hier
 * in beiden Richtungen, weil es ein Quadrat am Rand ist und kein Band über die volle Breite.
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
   * Die Treffertrennung. Die Zeile ist content-box (gemessen in `gate3-trefflaeche.spec.ts`:
   * 36 / 58 / 86 = Boden + 2 × paddingXS). Das Ziel zieht sich deshalb um genau die
   * Zeilenpolsterung nach rechts und in der Höhe heraus: es endet bündig an der Zeilenkante
   * und füllt ihre volle Höhe. Sonst bliebe rechts und über/unter ihm ein Streifen, der zur
   * Zeile gehört — genau dort, wo der Daumen das Ziel verfehlt, öffnete er den Datensatz.
   */
  it('sitzt bündig an der rechten Zeilenkante und füllt die volle Zeilenhöhe', () => {
    for (const stufe of ['kompakt', 'handschuh'] as const) {
      const t = tokenFuer(stufe);
      const stil = vorschauZielStil(t);
      expect(stil.marginInlineEnd, stufe).toBe(-t.paddingSM);
      expect(stil.marginBlock, stufe).toBe(-t.paddingXS);
      expect(stil.alignSelf, stufe).toBe('stretch');
      expect(stil.boxSizing, stufe).toBe('border-box');
    }
  });

  it('trennt sich sichtbar von der Zeile', () => {
    expect(vorschauZielStil(tokenFuer('kompakt')).borderInlineStart).toBe('1px solid #123456');
  });
});
