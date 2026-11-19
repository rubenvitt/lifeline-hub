import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Outlet, RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import { VerlaufMerken } from '../routing/VerlaufMerken';
import { verlaufGedaechtnisRaeumen } from '../routing/verlaufGedaechtnis';
import { ListenRueckweg } from './ListenRueckweg';

function Liste() {
  const { search } = useLocation();
  return <output data-testid="liste">{`liste${search}`}</output>;
}

function baue(start: string, ziel = '/liste') {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <VerlaufMerken />
            <Outlet />
          </>
        ),
        children: [
          { path: '/liste', element: <Liste /> },
          {
            path: '/detail/:id',
            element: <ListenRueckweg to={ziel}>Liste</ListenRueckweg>,
          },
        ],
      },
    ],
    { initialEntries: [start] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const link = () => screen.getByRole('link', { name: 'Liste' });

describe('ListenRueckweg', () => {
  beforeEach(() => {
    verlaufGedaechtnisRaeumen();
  });

  it('von der Liste gekommen: Klick geht zurück', async () => {
    const router = baue('/liste?q=meier');
    await act(() => router.navigate('/detail/1'));
    await act(async () => {
      fireEvent.click(link());
    });
    expect(await screen.findByTestId('liste')).toHaveTextContent('liste?q=meier');
    expect(router.state.historyAction).toBe('POP');
  });

  it('href trägt die Query der vorigen Liste', async () => {
    const router = baue('/liste?q=meier');
    await act(() => router.navigate('/detail/1'));
    expect(link()).toHaveAttribute('href', '/liste?q=meier');
  });

  it('direkt geöffnet: Link auf die nackte Liste', async () => {
    const router = baue('/detail/1');
    expect(link()).toHaveAttribute('href', '/liste');
    await act(async () => {
      fireEvent.click(link());
    });
    expect(await screen.findByTestId('liste')).toHaveTextContent(/^liste$/);
    expect(router.state.historyAction).toBe('PUSH');
  });

  it('von anderer Seite: Link', async () => {
    const router = baue('/liste');
    await act(() => router.navigate('/detail/2'));
    await act(() => router.navigate('/detail/1'));
    await act(async () => {
      fireEvent.click(link());
    });
    expect(router.state.location.pathname).toBe('/liste');
    expect(router.state.historyAction).toBe('PUSH');
  });

  it('Ziel mit Zeilenmarke passt über den Pfad', async () => {
    const router = baue('/liste?q=x', '/liste?personal=5');
    await act(() => router.navigate('/detail/1'));
    await act(async () => {
      fireEvent.click(link());
    });
    expect(await screen.findByTestId('liste')).toHaveTextContent('liste?q=x');
    expect(router.state.historyAction).toBe('POP');
  });

  it('Strg-Klick wird nicht abgefangen', async () => {
    const router = baue('/liste?q=meier');
    await act(() => router.navigate('/detail/1'));
    const vorher = router.state.location.key;
    // Der Browser öffnet den neuen Tab nur, wenn niemand `preventDefault` ruft
    // (`fireEvent` liefert dann `true`); die Seite selbst bleibt stehen.
    expect(fireEvent.click(link(), { ctrlKey: true })).toBe(true);
    expect(router.state.location.key).toBe(vorher);
  });
});
