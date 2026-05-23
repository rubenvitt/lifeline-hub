import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MitgliederPanel from './MitgliederPanel';

function mitglied(over: Partial<Record<string, unknown>> = {}) {
  return {
    benutzer_id: 2,
    anzeigename: 'Eva Einsatz',
    benutzername: 'eva',
    einsatz_rolle: 'fuehrungspersonal',
    zugewiesen_at: '2026-05-23 10:00:00',
    ...over,
  };
}

describe('MitgliederPanel', () => {
  it('zeigt vorhandene Mitglieder', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <MitgliederPanel einsatzId={7} istAktiv offen onClose={() => {}} />,
    );
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
  });

  it('entfernt ein Mitglied', async () => {
    let entfernt = false;
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () =>
        HttpResponse.json(entfernt ? [] : [mitglied()]),
      ),
      http.get('/api/benutzer', () => HttpResponse.json([])),
      http.delete('/api/einsaetze/7/mitglieder/2', () => {
        entfernt = true;
        return HttpResponse.json([]);
      }),
    );
    renderMitProviders(
      <MitgliederPanel einsatzId={7} istAktiv offen onClose={() => {}} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const popup = await screen.findByRole('tooltip');
    await userEvent.click(within(popup).getByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(screen.queryByText('Eva Einsatz')).not.toBeInTheDocument());
  });

  it('blendet Edit-Aktionen aus, wenn der Einsatz nicht aktiv ist', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <MitgliederPanel einsatzId={7} istAktiv={false} offen onClose={() => {}} />,
    );
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
  });
});
