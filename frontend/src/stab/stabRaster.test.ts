import { describe, expect, it } from 'vitest';
import { stabRasterStil, stabSpalten } from './stabRaster';

describe('Raster der Stab-Seite (design.md D1)', () => {
  it('eine Spalte unter md, zwei ab md, drei ab xl', () => {
    const ab = (bis: string[]) => (punkt: string) => bis.includes(punkt);
    expect(stabSpalten(ab([]))).toBe(1);
    expect(stabSpalten(ab(['md', 'lg']))).toBe(2);
    expect(stabSpalten(ab(['md', 'lg', 'xl']))).toBe(3);
  });

  it('teilt die Breite in gleiche Spalten, ohne Mindestbreite, die überlaufen könnte', () => {
    expect(stabRasterStil(3, 16).gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(stabRasterStil(1, 16).gap).toBe(16);
  });
});
