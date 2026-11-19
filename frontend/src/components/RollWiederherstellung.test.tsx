import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import RollWiederherstellung from './RollWiederherstellung';
import { merkeRolle, ROLL_FRIST_MS, rollGedaechtnisRaeumen } from '../routing/rollGedaechtnis';

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

function starte(eintraege: string[] = ['/a'], { strict = false }: { strict?: boolean } = {}) {
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
  render(
    strict ? (
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    ) : (
      <RouterProvider router={router} />
    ),
  );
  return router;
}

/**
 * Setzt die Position wie der Browser, mit Scroll-Ereignis. `ohneEreignis` stellt das Klemmen der
 * Position nach, das der Browser beim Zeichnen einer kürzeren Seite still vornimmt.
 */
const rolle = (y: number, { ohneEreignis = false }: { ohneEreignis?: boolean } = {}) => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  if (!ohneEreignis) window.dispatchEvent(new Event('scroll'));
};

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

  it('eine Adressänderung per replace nach dem Rollen verliert die Position nicht', async () => {
    const router = starte(['/a']);
    rolle(1400);
    await act(() => router.navigate('/a?richtung=extern', { replace: true }));
    // Die neue, kürzere Seite klemmt die Position, bevor das Aufräumen läuft (kein Scroll-Ereignis).
    rolle(300, { ohneEreignis: true });
    await act(() => router.navigate('/b'));
    hoehe_ = 3000;
    scrollTo.mockClear();
    await act(() => router.navigate(-1));
    expect(scrollTo).toHaveBeenCalledWith(0, 1400);
  });

  it('eine laufende Wiederherstellung übersteht eine Adressänderung per replace', async () => {
    const router = await hinUndZurueck();
    await act(() => router.navigate('/a?richtung=extern', { replace: true }));
    wachse(3000);
    expect(scrollTo).toHaveBeenCalledWith(0, 1400);
  });

  it('der Schlüssel „default“ eines frischen Ladens gilt nur für dieselbe Adresse', async () => {
    hoehe_ = 3000;
    const erster = starte(['/a']);
    rolle(1400);
    await act(() => erster.navigate('/b'));
    act(() => erster.dispose());
    document.body.innerHTML = '';
    scrollTo.mockClear();
    // Später im selben Tab: eine andere Adresse frisch geladen, wieder mit dem Schlüssel „default“.
    starte(['/c']);
    expect(scrollTo).not.toHaveBeenCalledWith(0, 1400);
  });

  it('ein Scroll-Ereignis, während die nächste Seite noch lädt, zählt nicht für die alte', async () => {
    let freigeben: () => void = () => {};
    const router = createMemoryRouter(
      [
        {
          element: (
            <>
              <RollWiederherstellung />
              <Outlet />
            </>
          ),
          children: [
            {
              path: '/b',
              loader: () =>
                new Promise<null>((r) => {
                  freigeben = () => r(null);
                }),
              element: null,
            },
            { path: '*', element: null },
          ],
        },
      ],
      { initialEntries: ['/a'] },
    );
    render(<RouterProvider router={router} />);
    rolle(1400);
    let weg: Promise<void> = Promise.resolve();
    act(() => {
      weg = router.navigate('/b');
    });
    // Ein Ladegerippe der alten Adresse ist kürzer: der Browser klemmt und meldet ein Ereignis.
    rolle(300);
    await act(async () => {
      freigeben();
      await weg;
    });
    hoehe_ = 3000;
    scrollTo.mockClear();
    await act(() => router.navigate(-1));
    expect(scrollTo).toHaveBeenCalledWith(0, 1400);
  });

  it('unter StrictMode überschreibt der Probeabbau die gemerkte Position nicht', () => {
    // Wie ein Neuladen beim Zurück: der Eintrag trägt seinen Schlüssel, die Position ist gemerkt.
    merkeRolle('k1', 1400);
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
      { initialEntries: [{ pathname: '/a', key: 'k1' }] },
    );
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
    wachse(3000);
    expect(scrollTo).toHaveBeenCalledWith(0, 1400);
  });
});
