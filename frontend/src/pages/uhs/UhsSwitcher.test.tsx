import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import UhsSwitcher from './UhsSwitcher';
import type { Uhs, UhsStatus } from '../../api/types';
import { App as AntApp } from 'antd';

function uhs(id: number, status: UhsStatus): Uhs {
  return {
    id,
    einsatz_id: 1,
    abschnitt_id: null,
    typ: 'behandlungsplatz',
    bezeichnung: `UHS ${id}`,
    standort: null,
    notiz: null,
    lat: null,
    lon: null,
    status,
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function renderSwitcher() {
  server.use(
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([uhs(3, 'aktiv'), uhs(9, 'geplant')])),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/unfallhilfsstellen/3']}>
          <UhsSwitcher einsatzId={1} aktuelleUhs={uhs(3, 'aktiv')} />
          <LocationProbe />
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('UhsSwitcher', () => {
  it('zeigt die aktuelle UHS und navigiert per Dropdown zu einer anderen', async () => {
    renderSwitcher();
    await userEvent.click(screen.getByRole('button', { name: /UHS 3/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /UHS 9/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/einsaetze/1/unfallhilfsstellen/9');
  });

  it('öffnet über „+ Neue UHS“ den Anlegen-Drawer', async () => {
    renderSwitcher();
    await userEvent.click(screen.getByRole('button', { name: /UHS 3/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Neue UHS/ }));
    expect(await screen.findByText('Unfallhilfsstelle anlegen')).toBeInTheDocument();
  });
});
