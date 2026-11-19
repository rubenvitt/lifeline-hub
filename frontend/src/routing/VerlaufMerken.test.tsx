import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { VerlaufMerken, useVorigeAdresse } from './VerlaufMerken';
import { verlaufGedaechtnisRaeumen } from './verlaufGedaechtnis';

function Sonde() {
  return <output data-testid="herkunft">{JSON.stringify(useVorigeAdresse())}</output>;
}

function baue(start: string) {
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
          { path: '/liste', element: <Sonde /> },
          { path: '/detail/:id', element: <Sonde /> },
        ],
      },
    ],
    { initialEntries: [start] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const herkunft = () => JSON.parse(screen.getByTestId('herkunft').textContent ?? 'null');

describe('VerlaufMerken', () => {
  beforeEach(() => {
    verlaufGedaechtnisRaeumen();
  });

  it('PUSH merkt die vorige Adresse', async () => {
    const router = baue('/liste?f.status=offen');
    await act(() => router.navigate('/detail/1'));
    expect(herkunft()).toEqual({ pathname: '/liste', search: '?f.status=offen' });
  });

  it('erster Eintrag hat keine Herkunft', () => {
    baue('/detail/1');
    expect(herkunft()).toBeNull();
  });

  it('REPLACE behält die Herkunft', async () => {
    const router = baue('/liste?f.status=offen');
    await act(() => router.navigate('/detail/1'));
    await act(() => router.navigate('/detail/1?reiter=b', { replace: true }));
    expect(herkunft()).toEqual({ pathname: '/liste', search: '?f.status=offen' });
  });

  it('POP liest die Herkunft des Eintrags', async () => {
    const router = baue('/liste');
    await act(() => router.navigate('/detail/1'));
    await act(() => router.navigate('/detail/2'));
    expect(herkunft()).toEqual({ pathname: '/detail/1', search: '' });
    await act(() => router.navigate(-1));
    expect(herkunft()).toEqual({ pathname: '/liste', search: '' });
  });
});

describe('useVorigeAdresse vor VerlaufMerken im Baum', () => {
  beforeEach(() => {
    verlaufGedaechtnisRaeumen();
  });

  it('zeichnet neu, sobald die Herkunft nach dem eigenen Rendern geschrieben ist', async () => {
    // Die Seite kann zeichnen, bevor das Layout die Herkunft schreibt (LLH-1997, e2e nach dem
    // Merge von LLH-1826); dann muss sie davon erfahren.
    const router = createMemoryRouter(
      [
        {
          element: (
            <>
              <Sonde />
              <VerlaufMerken />
              <Outlet />
            </>
          ),
          children: [
            { path: '/liste', element: null },
            { path: '/detail/:id', element: null },
          ],
        },
      ],
      { initialEntries: ['/liste?q=1'] },
    );
    render(<RouterProvider router={router} />);
    await act(() => router.navigate('/detail/1'));
    expect(herkunft()).toEqual({ pathname: '/liste', search: '?q=1' });
  });
});
