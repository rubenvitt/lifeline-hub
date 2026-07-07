import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useQueryParamSelektion } from './useQueryParamSelektion';

// LFH-156 (Root-Cause aus LFH-150): Der Hook darf die vom Router gelieferte
// searchParams-Instanz nicht in-place räumen (delete) — sonst wird sie zur
// StrictMode-Falle für künftige Konsumenten mit konkurrierendem Default-Effekt
// (Präzedenz-Fix: GefahrenPage.tsx, ein Effekt + geteilte Instanz + Default-Zweig).
// Da der Hook seine useSearchParams-Instanz kapselt, ist die Nicht-Mutation nur
// prüfbar, indem wir ihm über den Router-Boundary eine kontrollierte Instanz
// injizieren und danach direkt an DIESEM echten URLSearchParams-Objekt messen.
const h = vi.hoisted(() => ({
  setSearchParams: vi.fn(),
  ref: { sp: new URLSearchParams() },
}));

vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
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
    // Ohne den Klon-Fix stünde hier false, weil der Hook delete() direkt darauf aufriefe.
    expect(h.ref.sp.has('einheit')).toBe(true);

    // Das Aufräumen passiert stattdessen über setSearchParams mit einer NEUEN Instanz.
    expect(h.setSearchParams).toHaveBeenCalledTimes(1);
    const uebergeben = h.setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(uebergeben).not.toBe(h.ref.sp); // Klon, nicht dieselbe Referenz
    expect(uebergeben.has('einheit')).toBe(false); // der Klon ist geräumt
  });
});
