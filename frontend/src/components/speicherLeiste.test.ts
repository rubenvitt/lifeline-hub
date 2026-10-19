import { render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { antdToken, farbenHell, type Dichte } from '../theme/tokens';
import { speicherLeisteStil, useSpeicherLeiste } from './speicherLeiste';

const token = { colorBgContainer: '#fff', paddingSM: 8, padding: 11, colorBorderSecondary: '#ccc' };

describe('speicherLeisteStil', () => {
  it('bleibt für die Leiste mit EINEM Knopf, wie sie war', () => {
    const stil = speicherLeisteStil(token);
    expect(stil).toMatchObject({ position: 'sticky', bottom: 0, paddingBlock: 8 });
    // Die elf bisherigen Nutzer tragen genau „Speichern“: kein Reihenlayout, kein Abstand.
    expect(stil.display).toBeUndefined();
    expect(stil.gap).toBeUndefined();
  });

  it('mit „Abbrechen“: Reihe mit Abstand `padding`, wie der Fuß der Erfassungs-Hülle', () => {
    const stil = speicherLeisteStil(token, { hasAbbrechen: true });
    // Mutationsprobe: `gap: token.paddingSM` (7 px in `kompakt`) macht den Test rot.
    expect(stil).toMatchObject({
      position: 'sticky',
      display: 'flex',
      flexWrap: 'wrap',
      gap: token.padding,
    });
  });

  /**
   * Gemessen an der tatsächlichen Leiste unter dem Theme jeder Stufe, nicht an der Tokentabelle:
   * Mutationsprobe: `gap: token.paddingSM` (7/11/16 px) im Stil — rot; ebenso, wenn der Hook die
   * Option nicht an den Stil weiterreicht.
   */
  it('der Abstand hält die Leitlinie ≥ 8 px (Maus) bzw. ≥ 16 px (Touch) in jeder Stufe', () => {
    const boden: Record<Dichte, number> = { kompakt: 8, komfortabel: 16, handschuh: 16 };
    for (const dichte of Object.keys(boden) as Dichte[]) {
      const { unmount } = render(
        createElement(
          ConfigProvider,
          { theme: { token: antdToken(farbenHell, dichte) } },
          createElement(Leiste),
        ),
      );
      const leiste = screen.getByTestId('leiste');
      expect(leiste.style.display, dichte).toBe('flex');
      expect(parseFloat(leiste.style.gap), dichte).toBeGreaterThanOrEqual(boden[dichte]);
      unmount();
    }
  });
});

/** Die Leiste, wie eine Seite sie baut: `<div {...useSpeicherLeiste({ hasAbbrechen: true })}>`. */
function Leiste() {
  return createElement('div', {
    ...useSpeicherLeiste({ hasAbbrechen: true }),
    'data-testid': 'leiste',
  });
}
