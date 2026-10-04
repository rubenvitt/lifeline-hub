import { describe, expect, it } from 'vitest';
import { farbenDunkel, farbenHell } from '../../theme/tokens';
import { kontrast } from '../../test/farbmass';
import { ZURUECK_DECKKRAFT } from './SkizzenElemente';

/**
 * Zurückgenommene Elemente (Hervorheben, Filter) bleiben lesbar (Prüfliste Kriterium 5): der Text
 * in `currentColor` (`rollen.text`) hält mit der Deckkraft auf der Fläche den Boden 4,5 : 1 in
 * beiden Modi. Die Hervorhebung selbst trägt die Strichstärke, nicht die Deckkraft.
 */
function gemischt(vorne: string, hinten: string, deckkraft: number): string {
  const kanal = (hex: string, i: number) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const teile = [0, 1, 2].map((i) =>
    Math.round(deckkraft * kanal(vorne, i) + (1 - deckkraft) * kanal(hinten, i)),
  );
  return `#${teile.map((t) => t.toString(16).padStart(2, '0')).join('')}`;
}

describe('Deckkraft zurückgenommener Elemente', () => {
  it.each([
    ['hell', farbenHell],
    ['dunkel', farbenDunkel],
  ] as const)('hält im Modus %s den Textboden 4,5 : 1 auf der Fläche', (_modus, farben) => {
    expect(farben.text).toMatch(/^#[0-9a-f]{6}$/i);
    const text = gemischt(farben.text, farben.flaeche, ZURUECK_DECKKRAFT);
    expect(kontrast(text, farben.flaeche)).toBeGreaterThanOrEqual(4.5);
  });

  it('tritt dennoch sichtbar zurück', () => {
    expect(ZURUECK_DECKKRAFT).toBeLessThanOrEqual(0.7);
  });
});
