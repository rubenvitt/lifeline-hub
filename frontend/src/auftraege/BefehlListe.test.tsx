import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import BefehlListe from './BefehlListe';
import * as befehleApi from '../api/befehle';

vi.mock('../api/befehle');

function renderListe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter>
          <BefehlListe einsatzId={1} darfSchreiben />
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(befehleApi.listeBefehle).mockResolvedValue([
    { id: 7, einsatz_id: 1, vorlage: 'befehl_lad', titel: 'Befehl A', zeitstand: '2026-06-02 10:00:00',
      status: 'entwurf', abschnitte: [], version: 1, vorgaenger_id: null, ersteller_id: 1,
      ersteller_name: 'EL', erstellt_at: '', aktualisiert_at: '', freigegeben_von_id: null,
      freigegeben_von_name: null, freigegeben_at: null, etb_eintrag_id: null },
  ] as never);
});

describe('BefehlListe', () => {
  it('listet Befehle mit Schema-Label und Detail-Link', async () => {
    renderListe();
    const link = await screen.findByRole('link', { name: 'Befehl A' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/auftraege/befehle/7');
    expect(screen.getByText('Befehl LAD (vereinfacht)')).toBeInTheDocument();
  });

  it('zeigt "Befehl erteilen" bei Schreibrecht', async () => {
    renderListe();
    expect(await screen.findByRole('button', { name: 'Befehl erteilen' })).toBeInTheDocument();
  });
});
