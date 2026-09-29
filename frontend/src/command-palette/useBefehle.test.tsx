import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../test/utils';
import { authWertFixture, benutzerFixture, einsatzFixture } from '../test/fixtures';
import { merkeModulBesuch } from '../einsatz/zuletztModule';
import { useBefehle } from './useBefehle';

/** Die Person, die `useAuth` im Mock liefert; ihre `id` trennt den Zuletzt-Speicher. */
const ICH = benutzerFixture().id;

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
   * Die Naht der aktuellen Route: die Regel ist am reinen `baueBefehle` geprüft, hier hängt sie am
   * PFAD. Beide Hälften im selben Lauf ('personen' bleibt, 'etb' fällt heraus), sonst wäre auch
   * ein Riegel grün, der die Gruppe leert.
   */
  it('lässt das Modul der aktuellen Route aus der Zuletzt-Gruppe heraus', async () => {
    localStorage.clear();
    merkeModulBesuch(ICH, 5, 'personen');
    merkeModulBesuch(ICH, 5, 'etb');
    const { result } = renderHook(() => useBefehle(undefined, undefined, vi.fn()), {
      wrapper: wrapper('/einsaetze/5/etb'),
    });

    await waitFor(() => expect(result.current.some((b) => b.id === 'zuletzt:personen')).toBe(true));
    expect(result.current.some((b) => b.id === 'zuletzt:etb')).toBe(false);
    // Die Modul-Gruppe behält den Eintrag: sie zeigt den Modulbestand, keine Abkürzung.
    expect(result.current.some((b) => b.id === 'modul:etb')).toBe(true);
  });

  /**
   * Schichtwechsel am gemeinsamen Rechner (LFH-436): die Palette liest nur den Speicher der
   * angemeldeten Person. Die Vorbedingung (eigener Eintrag erscheint) macht die Abwesenheit des
   * fremden zur Aussage.
   */
  it('zeigt in der Zuletzt-Gruppe nur die Wahlen der angemeldeten Person', async () => {
    localStorage.clear();
    merkeModulBesuch(ICH + 1, 5, 'lagekarte');
    merkeModulBesuch(ICH, 5, 'personen');
    const { result } = renderHook(() => useBefehle(undefined, undefined, vi.fn()), {
      wrapper: wrapper('/einsaetze/5/etb'),
    });

    await waitFor(() => expect(result.current.some((b) => b.id === 'zuletzt:personen')).toBe(true));
    expect(result.current.some((b) => b.id === 'zuletzt:lagekarte')).toBe(false);
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
