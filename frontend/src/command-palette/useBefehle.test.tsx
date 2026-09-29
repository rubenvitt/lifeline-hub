// frontend/src/command-palette/useBefehle.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../test/utils';
import { authWertFixture, benutzerFixture, einsatzFixture } from '../test/fixtures';
import { useBefehle } from './useBefehle';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => authWertFixture(benutzerFixture({ org_rolle: 'fuehrungskraft' })),
}));
vi.mock('../api/einsaetze', () => ({
  listeEinsaetze: vi.fn(() => Promise.resolve([])),
  ladeModulOverrides: vi.fn(() => Promise.resolve({})),
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatzFixture({ id: 5 }))),
}));

function wrapper(route: string) {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('useBefehle', () => {
  it('liefert Modul-Befehle im Einsatz-Kontext', async () => {
    const { result } = renderHook(() => useBefehle(undefined, undefined, vi.fn()), {
      wrapper: wrapper('/einsaetze/5/etb'),
    });
    await waitFor(() => expect(result.current.some((b) => b.id === 'modul:etb')).toBe(true));
  });
  it('liefert keine Modul-Befehle außerhalb eines Einsatzes', () => {
    const { result } = renderHook(() => useBefehle(undefined, undefined, vi.fn()), {
      wrapper: wrapper('/profil'),
    });
    expect(result.current.some((b) => b.gruppe === 'module')).toBe(false);
  });

  /**
   * DIE NAHT der aktuellen Route (LFH-391 · C4, Arbeitspunkt 3): `befehle.test.ts` prüft die
   * Regel am reinen `baueBefehle`, hier hängt sie am PFAD. Ohne diesen Test bliebe
   * unbewiesen, dass der Schlüssel überhaupt aus der Route gezogen und durchgereicht wird.
   *
   * Beide Hälften im selben Lauf: 'personen' bleibt, 'etb' fällt heraus — ein Riegel, der
   * die ganze Gruppe leert, wäre sonst ebenso grün.
   */
  it('lässt das Modul der aktuellen Route aus der Zuletzt-Gruppe heraus', async () => {
    localStorage.setItem('lfh:nav:zuletzt:5', JSON.stringify(['etb', 'personen']));
    const { result } = renderHook(() => useBefehle(undefined, undefined, vi.fn()), {
      wrapper: wrapper('/einsaetze/5/etb'),
    });

    await waitFor(() => expect(result.current.some((b) => b.id === 'zuletzt:personen')).toBe(true));
    expect(result.current.some((b) => b.id === 'zuletzt:etb')).toBe(false);
    // Die Modul-Gruppe behält den Eintrag: sie zeigt den Modulbestand, keine Abkürzung.
    expect(result.current.some((b) => b.id === 'modul:etb')).toBe(true);
  });

  /**
   * DIE NAHT der Öffnungsart (LFH-645, Review-Befund): `befehle.test.ts` prüft das
   * Durchreichen am reinen `baueBefehle` mit einem eigenen `navigate`. Hier hängt es an der
   * VERDRAHTUNG — der Hook verwarf das zweite Argument (`(p) => navigate(p)`), und jede
   * Modul-, Zuletzt-, Schnellaktions- und Navigationszeile öffnete mit Strg/⌘+↵ still im
   * aktuellen Tab. Kein Test sah es: der Provider-Test mockt diesen Hook, e2e fuhr nur Person
   * und Koordinate.
   */
  it('reicht die Öffnungsart bis zum übergebenen navigate durch', async () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useBefehle(undefined, undefined, navigate), {
      wrapper: wrapper('/einsaetze/5/etb'),
    });
    await waitFor(() => expect(result.current.some((b) => b.id === 'modul:personen')).toBe(true));
    result.current.find((b) => b.id === 'modul:personen')!.ausfuehren('neuerTab');
    expect(navigate).toHaveBeenCalledWith('/einsaetze/5/personen', 'neuerTab');
    navigate.mockClear();
    result.current.find((b) => b.id === 'nav:profil')!.ausfuehren('neuerTab');
    expect(navigate).toHaveBeenCalledWith('/profil', 'neuerTab');
  });

  it('reicht die aktiven Tastaturaktionen als sichtbare Befehle durch', () => {
    const speichern = vi.fn();
    const { result } = renderHook(() => useBefehle({ speichern }, undefined, vi.fn()), {
      wrapper: wrapper('/profil'),
    });

    const befehl = result.current.find((b) => b.id === 'tastatur:speichern');
    expect(befehl).toBeDefined();
    befehl!.ausfuehren();
    expect(speichern).toHaveBeenCalledTimes(1);
  });
});
