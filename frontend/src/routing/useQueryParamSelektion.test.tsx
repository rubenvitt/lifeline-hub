import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import type { ReactNode } from 'react';
import { AdresseSteht } from '../test/adresseSteht';
import { deeplinkStand, useQueryParamSelektion } from './useQueryParamSelektion';

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
        useQueryParamSelektion('einheit', true, (id) => void angewendet.push(id));
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
        useQueryParamSelektion('einheit', true, (id) => void angewendet.push(id));
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
        useQueryParamSelektion('einheit', false, (id) => void angewendet.push(id));
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
        useQueryParamSelektion('einheit', bereit, (id) => void angewendet.push(id)),
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
        useQueryParamSelektion('einheit', true, (id) => void angewendet.push(id));
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

/**
 * Deeplink auf Unbekanntes (LLH-1827, Change `a12ms7g9-seitenzustaende`, D5; Spec
 * `seiten-zustaende`, „Deeplink auf ein Objekt, das es nicht gibt“): `anwenden` liefert `false`,
 * wenn es das Objekt nicht gibt; der Hook führt die Lage des Hinweises.
 */
describe('useQueryParamSelektion: Hinweislage (LLH-1827)', () => {
  it('Rückgabe false setzt die Lage auf die Kennung, der Parameter wird trotzdem geräumt', async () => {
    const { result } = renderHook(
      () => ({
        lage: useQueryParamSelektion('einheit', true, () => false),
        location: useLocation(),
      }),
      { wrapper: wrapper('/x?einheit=99') },
    );
    await waitFor(() => expect(result.current.lage.unbekannt).toBe(99));
    await waitFor(() => expect(result.current.location.search).toBe(''));
  });

  it('ohne false bleibt die Lage leer', async () => {
    const { result } = renderHook(
      () => ({
        lage: useQueryParamSelektion('einheit', true, () => {}),
        location: useLocation(),
      }),
      { wrapper: wrapper('/x?einheit=5') },
    );
    await waitFor(() => expect(result.current.location.search).toBe(''));
    expect(result.current.lage.unbekannt).toBeNull();
  });

  it('eine ungültige Kennung zeigt keinen Hinweis', async () => {
    const { result } = renderHook(
      () => ({
        lage: useQueryParamSelektion('einheit', true, () => false),
        location: useLocation(),
      }),
      { wrapper: wrapper('/x?einheit=abc') },
    );
    await waitFor(() => expect(result.current.location.search).toBe(''));
    expect(result.current.lage.unbekannt).toBeNull();
  });

  it('schliesse leert die Lage', async () => {
    const { result } = renderHook(() => useQueryParamSelektion('einheit', true, () => false), {
      wrapper: wrapper('/x?einheit=99'),
    });
    await waitFor(() => expect(result.current.unbekannt).toBe(99));
    act(() => result.current.schliesse());
    expect(result.current.unbekannt).toBeNull();
  });

  it('melde setzt die Lage für eine erst später als unbekannt erkannte Kennung', async () => {
    const { result } = renderHook(() => useQueryParamSelektion('einheit', true, () => {}), {
      wrapper: wrapper('/x'),
    });
    act(() => result.current.melde(42));
    expect(result.current.unbekannt).toBe(42);
  });

  it('ein neuer Deeplink setzt die Lage neu', async () => {
    const { result } = renderHook(
      () => ({
        lage: useQueryParamSelektion('einheit', true, (id) => (id === 5 ? undefined : false)),
        location: useLocation(),
        navigate: useNavigate(),
      }),
      { wrapper: wrapper('/x?einheit=99') },
    );
    await waitFor(() => expect(result.current.lage.unbekannt).toBe(99));
    await waitFor(() => expect(result.current.location.search).toBe(''));

    act(() => {
      void result.current.navigate('/x?einheit=5');
    });
    await waitFor(() => expect(result.current.location.search).toBe(''));
    expect(result.current.lage.unbekannt).toBeNull();

    act(() => {
      void result.current.navigate('/x?einheit=77');
    });
    await waitFor(() => expect(result.current.lage.unbekannt).toBe(77));
  });

  it('ein anderer Pfad (etwa ein anderer Einsatz) zeigt den Hinweis nicht weiter', async () => {
    const { result } = renderHook(
      () => ({
        lage: useQueryParamSelektion('einheit', true, () => false),
        navigate: useNavigate(),
      }),
      { wrapper: wrapper('/einsaetze/1/x?einheit=99') },
    );
    await waitFor(() => expect(result.current.lage.unbekannt).toBe(99));
    act(() => {
      void result.current.navigate('/einsaetze/2/x');
    });
    await waitFor(() => expect(result.current.lage.unbekannt).toBeNull());
  });
});

/**
 * Nur ein sicherer Befund zeigt den Hinweis (Review der Change `a12ms7g9-seitenzustaende`): ein
 * Stand aus dem Cache, dessen Neuabruf noch läuft, kennt ein eben angelegtes Objekt nicht.
 */
describe('deeplinkStand: angewandt gegen einen frischen Stand', () => {
  const geladen = { isSuccess: true, fetchStatus: 'idle' } as const;
  const neuAbruf = { isSuccess: true, fetchStatus: 'fetching' } as const;
  const angehalten = { isSuccess: true, fetchStatus: 'paused' } as const;
  const gescheitert = { isSuccess: false, fetchStatus: 'idle' } as const;

  it('wartet, solange ein Neuabruf über dem Cache läuft', () => {
    expect(deeplinkStand([neuAbruf])).toEqual({ bereit: false, sicher: false });
  });

  it('ist frisch geladen bereit und sicher', () => {
    expect(deeplinkStand([geladen])).toEqual({ bereit: true, sicher: true });
  });

  it('wendet ohne Netz den Cache an, meldet aber nichts als unbekannt', () => {
    expect(deeplinkStand([angehalten])).toEqual({ bereit: true, sicher: false });
  });

  it('wartet auf eine weitere Liste, die gerade lädt', () => {
    expect(deeplinkStand([geladen], [neuAbruf])).toEqual({ bereit: false, sicher: false });
  });

  it('eine gescheiterte weitere Liste hält nicht auf, macht den Befund aber unsicher', () => {
    expect(deeplinkStand([geladen], [gescheitert])).toEqual({ bereit: true, sicher: false });
  });

  it('der Hook zeigt bei unsicherem Stand keinen Hinweis und räumt den Parameter', async () => {
    const { result } = renderHook(
      () => ({
        lage: useQueryParamSelektion('einheit', { bereit: true, sicher: false }, () => false),
        location: useLocation(),
      }),
      { wrapper: wrapper('/x?einheit=99') },
    );
    await waitFor(() => expect(result.current.location.search).toBe(''));
    expect(result.current.lage.unbekannt).toBeNull();
  });

  it('der Hook zeigt bei sicherem Stand den Hinweis', async () => {
    const { result } = renderHook(
      () => useQueryParamSelektion('einheit', { bereit: true, sicher: true }, () => false),
      { wrapper: wrapper('/x?einheit=99') },
    );
    await waitFor(() => expect(result.current.unbekannt).toBe(99));
  });
});
