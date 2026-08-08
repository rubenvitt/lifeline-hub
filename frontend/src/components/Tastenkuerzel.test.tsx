import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import Tastenkuerzel, { tastenkuerzelStil } from './Tastenkuerzel';
import { dichten, form, schrift } from '../theme/tokens';

/**
 * Geprüft wird der INLINE-STYLE, nicht ein Pixel: jsdom rechnet kein Layout, und
 * `test/utils.tsx` montiert ein nacktes `ConfigProvider` OHNE unser Theme — eine
 * gerenderte Messung belegte antd-Vorgaben statt der Rollen. Deshalb die reine
 * Funktion gegen die Stufen aus `theme/tokens.ts`, nach dem Muster von
 * `bedienzielStil` (`pages/lagekarte/Sidebar.tsx`).
 */
describe('tastenkuerzelStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    paddingXS: dichten[stufe].abstand.xs,
    fontSizeSM: dichten[stufe].schriftgroesse - 2,
    fontFamilyCode: schrift.zahl,
  });

  /**
   * Der eigentliche Mangel war die FEHLENDE Marke: ohne Rahmen und ohne eigene
   * Schrift stand „⌘K" als nackter Text an „Suchen" geklebt. Rahmen und
   * Zahlenschrift sind das, was aus dem Text eine Taste macht.
   */
  it('macht aus dem Text eine Marke — Rahmen, Zahlenschrift, kein Umbruch', () => {
    const stil = tastenkuerzelStil(tokenFuer('kompakt'));
    expect(stil.border).toBe('1px solid currentColor');
    expect(stil.fontFamily).toBe(schrift.zahl);
    expect(stil.whiteSpace).toBe('nowrap');
  });

  /**
   * Radius 0 ist die Entscheidung aus LFH-352, nicht die antd-Vorgabe. Der Wert
   * steht als LITERAL da — aus `form.radiusMarke` zurückgelesen prüfte er die
   * Konstante gegen sich selbst.
   */
  it('trägt die Formensprache statt eines handgeschriebenen Radius', () => {
    expect(tastenkuerzelStil(tokenFuer('kompakt')).borderRadius).toBe(0);
    expect(form.radiusMarke).toBe(0);
  });

  /**
   * KEIN `controlHeight`-Boden: ein `<kbd>` ist Satz, kein Bedienziel. Die Zusicherung
   * ist die Abwesenheit — ohne sie zöge jemand die Regel aus LFH-365 auf die Marke
   * und stellte im Handschuh-Betrieb eine 72 px hohe Taste neben eine Textzeile.
   */
  it('ist kein Bedienziel und bekommt deshalb keinen Höhenboden', () => {
    expect(tastenkuerzelStil(tokenFuer('handschuh'))).not.toHaveProperty('minHeight');
  });

  /**
   * Die Polsterung ZIEHT MIT. Ein festgenagelter Wert bestünde die Prüfungen oben,
   * die Ungleichheit über die Stufen ließe ihn auffliegen.
   */
  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const polster = (['kompakt', 'komfortabel', 'handschuh'] as const).map(
      (s) => tastenkuerzelStil(tokenFuer(s)).padding,
    );
    expect(polster).toEqual(['0 3px', '0 5px', '0 7px']);
  });
});

describe('Tastenkuerzel', () => {
  it('rendert ein <kbd> und lässt den Aufrufer ergänzen, ohne den Stil zu verlieren', () => {
    renderMitProviders(<Tastenkuerzel style={{ marginLeft: 'auto' }}>⌘K</Tastenkuerzel>);

    const marke = screen.getByText('⌘K');
    expect(marke.tagName).toBe('KBD');
    expect(marke.style.marginLeft).toBe('auto');
    expect(marke.style.whiteSpace).toBe('nowrap');
  });
});
