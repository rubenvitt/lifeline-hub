import { afterEach, describe, expect, it, vi } from 'vitest';

// Ein Wurf, der kein Kombinationsverbot ist (CompositionError/NotMeasuredError), deutet auf einen
// Programmfehler: Rückfall wie sonst, in DEV aber mit Warnung (design.md D3).
vi.mock('@einsatzzeichen/core', async (original) => {
  const echt = await original<typeof import('@einsatzzeichen/core')>();
  return {
    ...echt,
    drawSymbol: vi.fn((spec: { organization?: string; states?: readonly string[] }) => {
      if (spec.organization) throw new TypeError('kaputt');
      // Ein Schadensgrad, den die Bibliothek nicht zusammensetzt (LLH-1115, design.md D2).
      if (spec.states?.includes('destroyed')) {
        throw new echt.NotMeasuredError('Schadensgrad nicht vermessen', 'states' as never);
      }
      return echt.drawSymbol(spec as Parameters<typeof echt.drawSymbol>[0]);
    }),
  };
});

const { fachobjektZeichen } = await import('./fachobjektZeichen');
const { schadenTz } = await import('../pages/lagekarte/taktischesZeichen');

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

describe('fachobjektZeichen — Schadensgrad nicht darstellbar (LLH-1115)', () => {
  it('fällt auf den Gefahrenhinweis ohne Schadensgrad zurück, ohne Warnung', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const z = fachobjektZeichen(schadenTz('gross', 'elektrizitaet', 'zerstoert'));
    expect(z?.spec).toEqual({
      kind: 'hazard',
      technicalFill: 'orange',
      states: ['electrical-energy-hazard'],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('fällt ohne Gefahrenart auf das leere Dreieck zurück', () => {
    const z = fachobjektZeichen(schadenTz('gross', null, 'zerstoert'));
    expect(z?.spec).toEqual({ kind: 'hazard', technicalFill: 'orange' });
  });
});
