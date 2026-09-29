import { afterEach, describe, expect, it, vi } from 'vitest';

// Ein Wurf, der kein Kombinationsverbot ist (CompositionError/NotMeasuredError), deutet auf einen
// Programmfehler: Rückfall wie sonst, in DEV aber mit Warnung (design.md D3).
vi.mock('@einsatzzeichen/core', async (original) => {
  const echt = await original<typeof import('@einsatzzeichen/core')>();
  return {
    ...echt,
    drawSymbol: vi.fn((spec: { organization?: string }) => {
      if (spec.organization) throw new TypeError('kaputt');
      return echt.drawSymbol(spec as Parameters<typeof echt.drawSymbol>[0]);
    }),
  };
});

const { fachobjektZeichen } = await import('./fachobjektZeichen');

describe('fachobjektZeichen — unerwarteter Fehler', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fällt zurück und warnt in DEV', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const z = fachobjektZeichen({ grundzeichen: 'person', organisation: 'thw' });
    expect(z?.spec).toEqual({ kind: 'person' });
    expect(warn).toHaveBeenCalledWith(
      '[fachobjektZeichen] unerwarteter Fehler beim Zeichnen',
      expect.objectContaining({ organization: 'thw' }),
      expect.any(TypeError),
    );
  });
});
