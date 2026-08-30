// frontend/src/command-palette/zeilenStil.test.ts
import { describe, it, expect } from 'vitest';
import { palettenZeilenStil } from './zeilenStil';
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
