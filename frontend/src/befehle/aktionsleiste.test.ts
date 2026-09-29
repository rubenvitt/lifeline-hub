import { describe, expect, it } from 'vitest';
import { aktionsleisteStil, AKTIONSLEISTE_AB } from './aktionsleiste';

/**
 * Die Ungleichheit über beide Breitenzweige ist die Aussage: eine Leiste, die in JEDER Breite
 * verankert ist, erfüllt „bei 390 px verankert" ebenfalls und wäre trotzdem falsch.
 */

const TOKEN = {
  colorBgContainer: '#fff',
  paddingSM: 12,
  colorBorderSecondary: '#f0f0f0',
  marginSM: 8,
};

describe('aktionsleisteStil (LFH-465)', () => {
  it('verankert unterhalb der Schwelle am unteren Rand', () => {
    const stil = aktionsleisteStil(true, TOKEN);
    expect(stil.position).toBe('sticky');
    expect(stil.bottom).toBe(0);
    // Eigener Grund: eine durchsichtige Leiste über Markdown ist von „nicht da" nicht zu unterscheiden.
    expect(stil.background).toBe(TOKEN.colorBgContainer);
    expect(stil.borderTop).toContain(TOKEN.colorBorderSecondary);
  });

  it('verankert oberhalb der Schwelle NICHT — dort stehen die Aktionen im Kopf', () => {
    const stil = aktionsleisteStil(false, TOKEN);
    expect(stil.position).toBeUndefined();
    expect(stil.borderTop).toBeUndefined();
  });

  /**
   * Die Schwelle kommt aus antd über `useViewport` und wird nicht als Pixelzahl gespiegelt;
   * ein handgeschriebenes `1024` wäre die zweite Wahrheit, gegen die der Viewport-Guard gebaut ist.
   */
  it('hängt an der antd-Stufe `lg`, nicht an einer gespiegelten Pixelzahl', () => {
    expect(AKTIONSLEISTE_AB).toBe('lg');
  });
});
