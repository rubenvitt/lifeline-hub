import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { appRouten } from '../App';
import { neuerQueryClient } from '../test/utils';
import { meHandler, server } from '../test/server';
import { adminFixture } from '../test/fixtures';
import { setzeViewportBreite } from '../test/viewport';
import { defaultAdminPfad } from '../admin/adminNav';

/**
 * „?“ im Kopf jedes Rahmens (LLH-1824) über die echte Routenquelle: der Provider in `App.tsx` und
 * die Knöpfe in `AppLayout`/`EinsatzLayout` werden zusammen geprüft.
 */

const admin = adminFixture();
const einsatz = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  stichwort: null,
  status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
};

afterEach(() => vi.restoreAllMocks());

function renderApp(route: string) {
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
  );
  const router = createMemoryRouter(appRouten, { initialEntries: [route] });
  render(
    <QueryClientProvider client={neuerQueryClient()}>
      <ConfigProvider>
        <AntApp>
          <RouterProvider router={router} />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

const knopf = () =>
  screen.findByRole('button', { name: 'Hilfe zu dieser Seite' }, { timeout: 5000 });

describe('Knopf „?“ im Kopf', () => {
  it.each([
    ['Einsatzliste', '/einsaetze'],
    ['Einsatz', '/einsaetze/7/ueberblick'],
    ['Verwaltung', defaultAdminPfad()],
  ])('%s: steht im Kopf', async (_name, pfad) => {
    renderApp(pfad);
    const k = await knopf();
    expect(k.closest('header')).not.toBeNull();
  });

  it('Einsatz am Handy: steht im Fuß der Navigation', async () => {
    setzeViewportBreite(390);
    renderApp('/einsaetze/7/ueberblick');
    (await screen.findByRole('button', { name: /Navigation|Menü/ }, { timeout: 5000 })).click();
    const nav = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(within(nav).getByRole('button', { name: /Hilfe zu dieser Seite/ })).toBeInTheDocument();
  });

  it('auf der Hilfeseite gibt es ihn nicht', async () => {
    renderApp('/hilfe/anmelden-abmelden');
    await screen.findByRole('heading', { level: 1, name: 'Hilfe' }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Hilfe zu dieser Seite' })).toBeNull();
  });
});
