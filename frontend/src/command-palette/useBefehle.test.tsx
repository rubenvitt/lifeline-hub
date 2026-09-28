import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../test/utils';
import { useBefehle } from './useBefehle';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    benutzer: {
      id: 1,
      anzeigename: 'EL',
      benutzername: 'el',
      system_rolle: 'keiner',
      org_rolle: 'fuehrungskraft',
      aktiv: true,
      erstellt_at: '',
    },
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('../api/einsaetze', () => ({
  listeEinsaetze: vi.fn(() => Promise.resolve([])),
  ladeModulOverrides: vi.fn(() => Promise.resolve({})),
  ladeEinsatz: vi.fn(() =>
    Promise.resolve({
      id: 5,
      bezeichnung: 'Test-Einsatz',
      stichwort: null,
      status: 'aktiv',
      begonnen_at: '',
      abgeschlossen_at: null,
      abgeschlossen_von: null,
      einsatzart: 'realeinsatz',
      einsatznummer_intern: null,
      angelegt_at: '',
      leitstellen_nr: null,
      einsatzort: null,
      einsatzort_lat: null,
      einsatzort_lon: null,
      meldende_stelle: null,
      sachverhalt: null,
      anzahl_betroffene_initial: null,
      meine_rolle: 'einsatzleitung',
      org_id: 1,
      org_name: 'KV',
    }),
  ),
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
   * Die Naht der aktuellen Route: die Regel ist am reinen `baueBefehle` geprüft, hier hängt sie am
   * PFAD. Beide Hälften im selben Lauf ('personen' bleibt, 'etb' fällt heraus), sonst wäre auch
   * ein Riegel grün, der die Gruppe leert.
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
   * Die Naht der Öffnungsart: der Hook muss das zweite Argument an das übergebene `navigate`
   * weiterreichen, sonst öffnet Strg/⌘+↵ jede feste Zeile still im aktuellen Tab. Der Provider-Test
   * mockt diesen Hook und sähe das nicht.
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
