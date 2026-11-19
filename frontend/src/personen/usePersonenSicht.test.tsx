import { describe, expect, it } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { usePersonenSicht } from './usePersonenSicht';

let stand: {
  sicht: ReturnType<typeof usePersonenSicht>[0];
  setze: ReturnType<typeof usePersonenSicht>[1];
  search: string;
};
const setzer: unknown[] = [];

function Sonde() {
  const [sicht, setze] = usePersonenSicht();
  stand = { sicht, setze, search: useLocation().search };
  if (setzer[setzer.length - 1] !== setze) setzer.push(setze);
  return null;
}

function starte(route: string) {
  setzer.length = 0;
  const router = createMemoryRouter([{ path: '*', element: <Sonde /> }], {
    initialEntries: [route],
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('usePersonenSicht (LLH-1826)', () => {
  it('liest die Sicht aus der Adresse, Fehlendes ist Vorgabe', () => {
    starte('/p?ansicht=raster&luecken=1');
    expect(stand.sicht).toEqual({
      ansicht: 'raster',
      filter: 'alle',
      nurLuecken: true,
      abgeschlossen: false,
    });
  });

  it('schreibt nur, was von der Vorgabe abweicht', async () => {
    starte('/p?ansicht=raster&x=1');
    act(() => stand.setze((alt) => ({ ...alt, ansicht: 'zeilen', filter: 'vermisst' })));
    await waitFor(() => expect(stand.search).toBe('?x=1&filter=vermisst'));
  });

  it('zwei Änderungen im selben Zug bauen aufeinander auf', async () => {
    starte('/p');
    act(() => {
      stand.setze((alt) => ({ ...alt, filter: 'vermisst' }));
      stand.setze((alt) => ({ ...alt, nurLuecken: true }));
    });
    await waitFor(() => expect(stand.search).toBe('?filter=vermisst&luecken=1'));
  });

  it('der Setter bleibt über Navigationen derselbe', async () => {
    starte('/p');
    act(() => stand.setze((alt) => ({ ...alt, filter: 'vermisst' })));
    await waitFor(() => expect(stand.search).toBe('?filter=vermisst'));
    expect(setzer).toHaveLength(1);
  });
});
