import { describe, expect, it } from 'vitest';
import { cssForm } from './cssForm';

describe('cssForm (LLH-2023)', () => {
  it('schreibt einen Wert so, wie `element.style` ihn zurückgibt', () => {
    const el = document.createElement('div');
    el.style.boxShadow = 'inset 0 3px 0 #4d94d6';
    el.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    expect(el.style.boxShadow).toBe(cssForm('box-shadow', 'inset 0 3px 0 #4d94d6'));
    expect(el.style.gridTemplateColumns).toBe(
      cssForm('grid-template-columns', 'repeat(2, minmax(0, 1fr))'),
    );
  });

  it('unterscheidet weiter, was verschieden ist', () => {
    expect(cssForm('box-shadow', 'inset 0 3px 0 #4d94d6')).not.toBe(
      cssForm('box-shadow', 'inset 0 2px 0 #4d94d6'),
    );
    expect(cssForm('box-shadow', 'inset 0 3px 0 #4d94d6')).not.toBe(
      cssForm('box-shadow', '0 3px 0 #4d94d6'),
    );
  });

  it('lehnt einen ungültigen Wert laut ab, statt leer zu vergleichen', () => {
    expect(() => cssForm('box-shadow', 'quatsch')).toThrow(/kein gültiger Wert/);
    expect(() => cssForm('boxShadow', '0 0 0 1px red')).toThrow(/kein gültiger Wert/);
  });
});
