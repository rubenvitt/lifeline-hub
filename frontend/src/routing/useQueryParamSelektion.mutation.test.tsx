import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useQueryParamSelektion } from './useQueryParamSelektion';

// Der Hook darf die vom Router gelieferte searchParams-Instanz nicht in-place räumen, sonst
// sähe ein konkurrierender Default-Effekt den Param schon geräumt. Prüfbar nur, indem über den
// Router-Boundary eine kontrollierte Instanz injiziert und an ihr gemessen wird.
const h = vi.hoisted(() => ({
  setSearchParams: vi.fn(),
  ref: { sp: new URLSearchParams() },
}));

vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>();
  return { ...actual, useSearchParams: () => [h.ref.sp, h.setSearchParams] as const };
});

describe('useQueryParamSelektion – Nicht-Mutation (LFH-156)', () => {
  it('räumt den Param über einen Klon und lässt die gelieferte Instanz unangetastet', async () => {
    h.ref.sp = new URLSearchParams('einheit=5');
    h.setSearchParams.mockClear();
    const angewendet: number[] = [];
    renderHook(() => useQueryParamSelektion('einheit', true, (id) => angewendet.push(id)));

    // Der Effekt lief (die ID wurde angewandt) …
    await waitFor(() => expect(angewendet).toEqual([5]));

    // … aber die vom Router gelieferte Instanz wurde NICHT in-place geräumt.
    expect(h.ref.sp.has('einheit')).toBe(true);

    // Das Aufräumen passiert stattdessen über setSearchParams mit einer NEUEN Instanz.
    expect(h.setSearchParams).toHaveBeenCalledTimes(1);
    const uebergeben = h.setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(uebergeben).not.toBe(h.ref.sp); // Klon, nicht dieselbe Referenz
    expect(uebergeben.has('einheit')).toBe(false); // der Klon ist geräumt
  });
});
