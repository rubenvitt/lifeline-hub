import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import RollWiederherstellung from './RollWiederherstellung';
import { ROLL_FRIST_MS, rollGedaechtnisRaeumen } from '../routing/rollGedaechtnis';

/** Ein `ResizeObserver`, dessen Rückrufe der Test selbst auslöst. */
const beobachter: Array<() => void> = [];
class ResizeObserverSonde {
  constructor(private rueckruf: () => void) {}
  observe() {
    beobachter.push(this.rueckruf);
  }
  unobserve() {}
  disconnect() {
    const i = beobachter.indexOf(this.rueckruf);
    if (i >= 0) beobachter.splice(i, 1);
  }
}
const wachse = (hoehe: number) => {
  hoehe_ = hoehe;
  act(() => [...beobachter].forEach((f) => f()));
};

let hoehe_ = 800;
let scrollTo: ReturnType<typeof vi.fn>;

function starte(eintraege: string[] = ['/a']) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <RollWiederherstellung />
            <Outlet />
          </>
        ),
        children: [{ path: '*', element: null }],
      },
    ],
    { initialEntries: eintraege, initialIndex: eintraege.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const rolle = (y: number) =>
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });

describe('RollWiederherstellung (LLH-1826)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rollGedaechtnisRaeumen();
    beobachter.length = 0;
    hoehe_ = 800;
    vi.stubGlobal('ResizeObserver', ResizeObserverSonde);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      get: () => hoehe_,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    rolle(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Auf `/a` bei 1400 stehen, nach `/b` gehen und zurück. */
  async function hinUndZurueck(ziel = '/a') {
    const router = starte([ziel]);
    rolle(1400);
    await act(() => router.navigate('/b'));
    rolle(0);
    scrollTo.mockClear();
    await act(() => router.navigate(-1));
    return router;
  }

  it('POP rollt zurück, sobald die Seite hoch genug ist', async () => {
    await hinUndZurueck();
    expect(scrollTo).not.toHaveBeenCalledWith(0, 1400);
    wachse(3000);
    expect(scrollTo).toHaveBeenCalledWith(0, 1400);
  });

  it('POP rollt sofort, wenn die Seite schon hoch genug ist', async () => {
    hoehe_ = 3000;
    await hinUndZurueck();
    expect(scrollTo).toHaveBeenCalledWith(0, 1400);
  });

  it('gibt nach ROLL_FRIST_MS auf', async () => {
    await hinUndZurueck();
    await act(() => vi.advanceTimersByTimeAsync(ROLL_FRIST_MS));
    wachse(3000);
    expect(scrollTo).not.toHaveBeenCalledWith(0, 1400);
  });

  it('eigene Eingabe bricht ab', async () => {
    await hinUndZurueck();
    act(() => {
      window.dispatchEvent(new Event('wheel'));
    });
    wachse(3000);
    expect(scrollTo).not.toHaveBeenCalledWith(0, 1400);
  });

  it('PUSH beginnt oben', async () => {
    const router = starte(['/a']);
    rolle(500);
    scrollTo.mockClear();
    await act(() => router.navigate('/b'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('REPLACE rollt nicht', async () => {
    const router = starte(['/a']);
    rolle(500);
    scrollTo.mockClear();
    await act(() => router.navigate('/a?richtung=extern', { replace: true }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('ein Deeplink-Ziel hat Vorrang', async () => {
    hoehe_ = 3000;
    await hinUndZurueck('/a?meldung=7');
    expect(scrollTo).not.toHaveBeenCalledWith(0, 1400);
  });

  it('setzt history.scrollRestoration auf manual und beim Abbau zurück', () => {
    history.scrollRestoration = 'auto';
    const router = starte(['/a']);
    expect(history.scrollRestoration).toBe('manual');
    act(() => router.dispose());
    document.body.innerHTML = '';
  });
});
