import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import type { ReactNode } from 'react';
import { AdresseSteht } from '../test/adresseSteht';
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
        useQueryParamSelektion('einheit', true, (id) => {
          if (id === 5) angewendet.push(id);
        });
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

/**
 * Einmal je Verlaufseintrag (LLH-1530): Bis der Router die Räumung committet, steht der Param noch
 * in `searchParams`. Wechselt `bereit` in dieser Zeit (die Liste lädt neu), setzte der Effekt die
 * Selektion sonst ein zweites Mal.
 */
describe('useQueryParamSelektion: einmal je Verlaufseintrag (LLH-1530)', () => {
  it('ein hängender Router-Commit wendet die Selektion nach einem Wechsel von bereit nicht noch einmal an', async () => {
    const angewendet: number[] = [];
    const { rerender } = renderHook(
      ({ bereit }: { bereit: boolean }) =>
        useQueryParamSelektion('einheit', bereit, (id) => angewendet.push(id)),
      {
        initialProps: { bereit: true },
        wrapper: ({ children }: { children: ReactNode }) => (
          <MemoryRouter initialEntries={['/x?einheit=5']}>
            <AdresseSteht>{children}</AdresseSteht>
          </MemoryRouter>
        ),
      },
    );
    await waitFor(() => expect(angewendet).toEqual([5]));

    rerender({ bereit: false });
    rerender({ bereit: true });
    expect(angewendet).toEqual([5]);
  });

  it('ein neuer Link derselben Art wirkt wieder', async () => {
    const angewendet: number[] = [];
    const { result } = renderHook(
      () => {
        useQueryParamSelektion('einheit', true, (id) => angewendet.push(id));
        return { location: useLocation(), navigate: useNavigate() };
      },
      { wrapper: wrapper('/x?einheit=5') },
    );
    await waitFor(() => expect(result.current.location.search).toBe(''));
    expect(angewendet).toEqual([5]);

    act(() => {
      void result.current.navigate('/x?einheit=5');
    });
    await waitFor(() => expect(angewendet).toEqual([5, 5]));
    await waitFor(() => expect(result.current.location.search).toBe(''));
  });
});
