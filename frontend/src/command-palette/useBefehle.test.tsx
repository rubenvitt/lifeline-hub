// frontend/src/command-palette/useBefehle.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../test/utils';
import { useBefehle } from './useBefehle';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1, anzeigename: 'EL', benutzername: 'el', system_rolle: 'keiner', org_rolle: 'fuehrungskraft', aktiv: true, erstellt_at: '' }, laedt: false, login: vi.fn(), logout: vi.fn() }),
}));
vi.mock('../api/einsaetze', () => ({
  listeEinsaetze: vi.fn(() => Promise.resolve([])),
  ladeModulOverrides: vi.fn(() => Promise.resolve({})),
  ladeEinsatz: vi.fn(() => Promise.resolve({
    id: 5, bezeichnung: 'Test-Einsatz', stichwort: null, status: 'aktiv',
    begonnen_at: '', abgeschlossen_at: null, abgeschlossen_von: null,
    einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
    leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
    meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'KV',
  })),
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
    const { result } = renderHook(() => useBefehle(), { wrapper: wrapper('/einsaetze/5/etb') });
    await waitFor(() => expect(result.current.some((b) => b.id === 'modul:etb')).toBe(true));
  });
  it('liefert keine Modul-Befehle außerhalb eines Einsatzes', () => {
    const { result } = renderHook(() => useBefehle(), { wrapper: wrapper('/profil') });
    expect(result.current.some((b) => b.gruppe === 'module')).toBe(false);
  });
});
