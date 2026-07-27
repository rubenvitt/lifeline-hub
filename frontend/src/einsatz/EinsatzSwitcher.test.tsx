import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinsatzSwitcher from './EinsatzSwitcher';

function einsatz(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
    begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null,
    abgeschlossen_von: null, meine_rolle: 'einsatzleitung', ...over,
  };
}

function setup() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/*" element={<EinsatzSwitcher aktuellName="Hochwasser" />} />
      <Route path="/einsaetze" element={<div>Heim-Seite</div>} />
      <Route path="/stammdaten" element={<div>Stammdaten-Seite</div>} />
    </Routes>,
    { route: '/einsaetze/7/etb' },
  );
}

describe('EinsatzSwitcher', () => {
  it('zeigt nur aktive Einsaetze plus Aktionen', async () => {
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json([
          einsatz({ id: 7, bezeichnung: 'Hochwasser' }),
          einsatz({ id: 8, bezeichnung: 'MANV B14' }),
          einsatz({ id: 9, bezeichnung: 'Alt-Einsatz', status: 'abgeschlossen' }),
        ]),
      ),
    );
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    await waitFor(() => expect(screen.getByText('MANV B14')).toBeInTheDocument());
    expect(screen.queryByText('Alt-Einsatz')).not.toBeInTheDocument();
    expect(screen.getByText('Alle Einsätze …')).toBeInTheDocument();
    expect(screen.getByText('Stammdaten')).toBeInTheDocument();
  });

  it('navigiert ueber „Alle Einsätze …" zur Heim-Seite', async () => {
    server.use(http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])));
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    await userEvent.click(await screen.findByText('Alle Einsätze …'));
    await waitFor(() => expect(screen.getByText('Heim-Seite')).toBeInTheDocument());
  });
});
