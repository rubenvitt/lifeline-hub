import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useQueryParamSelektion } from './useQueryParamSelektion';

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe('useQueryParamSelektion (LFH-25)', () => {
  it('wendet einen gültigen ?key= einmal an und räumt den Param (apply-then-clean)', async () => {
    const angewendet: number[] = [];
    const { result } = renderHook(
      () => {
        useQueryParamSelektion('einheit', true, (id) => angewendet.push(id));
        return useLocation();
      },
      { wrapper: wrapper('/x?einheit=5') },
    );
    await waitFor(() => expect(angewendet).toEqual([5]));
    await waitFor(() => expect(result.current.search).toBe(''));
  });

  it('ignoriert ungültige IDs, räumt den Param aber trotzdem', async () => {
    const angewendet: number[] = [];
    const { result } = renderHook(
      () => {
        useQueryParamSelektion('einheit', true, (id) => angewendet.push(id));
        return useLocation();
      },
      { wrapper: wrapper('/x?einheit=abc') },
    );
    await waitFor(() => expect(result.current.search).toBe(''));
    expect(angewendet).toEqual([]);
  });

  it('räumt den Param auch, wenn die anwenden-Closure die ID ablehnt (Existenz-Guard false)', async () => {
    const angewendet: number[] = [];
    const { result } = renderHook(
      () => {
        useQueryParamSelektion('einheit', true, (id) => { if (id === 5) angewendet.push(id); });
        return useLocation();
      },
      { wrapper: wrapper('/x?einheit=99') },
    );
    await waitFor(() => expect(result.current.search).toBe(''));
    expect(angewendet).toEqual([]);
  });

  it('wartet auf bereit=true (lässt Param stehen, solange nicht bereit)', () => {
    const angewendet: number[] = [];
    const { result } = renderHook(
      () => {
        useQueryParamSelektion('einheit', false, (id) => angewendet.push(id));
        return useLocation();
      },
      { wrapper: wrapper('/x?einheit=5') },
    );
    expect(angewendet).toEqual([]);
    expect(result.current.search).toBe('?einheit=5');
  });
});
