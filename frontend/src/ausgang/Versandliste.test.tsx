import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import type { Versand } from '../api/types';
import Versandliste from './Versandliste';

const versand = (over: Partial<Versand>): Versand => ({
  id: 'v1',
  address: 'ils@example.org',
  agency_id: 1,
  agency_name: 'ILS Nord',
  attempts: 0,
  channel: 'email',
  created_at: '2026-11-24 14:00:00',
  created_by_id: 1,
  error: null,
  handed_over_at: null,
  smtp_status: null,
  source_id: 5,
  source_kind: 'lagebericht',
  state: 'wartet',
  subject: 'Lagebericht',
  without_pdf: false,
  ...over,
});

const quelle = { kind: 'lagebericht', id: 5 } as const;

function liste(v: Versand[]) {
  server.use(http.get('/api/incidents/1/deliveries', () => HttpResponse.json(v)));
}

afterEach(() => setzeOnline(true));

describe('Versandliste (LLH-2093)', () => {
  it('zeigt die Zustände und bietet „Erneut senden“ nur bei fehlgeschlagen', async () => {
    liste([
      versand({ id: 'a', state: 'wartet' }),
      versand({ id: 'b', state: 'uebergeben', handed_over_at: '2026-11-24 13:32:00' }),
      versand({ id: 'c', state: 'fehlgeschlagen', error: 'abgelehnt' }),
      versand({ id: 'd', state: 'fehlgeschlagen', error: 'ungewiss' }),
    ]);
    renderMitProviders(<Versandliste einsatzId={1} quelle={quelle} />);

    expect(await screen.findByText('wartet')).toBeInTheDocument();
    expect(screen.getByText(/^übergeben \d{2}:?\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText('fehlgeschlagen: Vom Mailserver abgelehnt')).toBeInTheDocument();
    expect(screen.getByText('Zustellung unklar')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Erneut senden' })).toHaveLength(2);
  });

  it('schickt „Erneut senden“ als POST an /retry', async () => {
    liste([versand({ id: 'c', state: 'fehlgeschlagen', error: 'abgelehnt' })]);
    let pfad = '';
    server.use(
      http.post('/api/incidents/1/deliveries/:id/retry', ({ request }) => {
        pfad = new URL(request.url).pathname;
        return HttpResponse.json(versand({ id: 'c', state: 'wartet' }));
      }),
    );
    renderMitProviders(<Versandliste einsatzId={1} quelle={quelle} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Erneut senden' }));
    await waitFor(() => expect(pfad).toBe('/api/incidents/1/deliveries/c/retry'));
  });

  it('rendert nichts ohne Versand', async () => {
    liste([]);
    const { container } = renderMitProviders(<Versandliste einsatzId={1} quelle={quelle} />);
    await waitFor(() => expect(container.querySelector('[data-lfh="versandliste"]')).toBeNull());
  });

  it('sperrt „Erneut senden“ ohne Netz mit sichtbarem Grund', async () => {
    liste([versand({ id: 'c', state: 'fehlgeschlagen', error: 'abgelehnt' })]);
    renderMitProviders(<Versandliste einsatzId={1} quelle={quelle} />);
    const knopf = await screen.findByRole('button', { name: 'Erneut senden' });
    setzeOnline(false);
    await waitFor(() => expect(knopf).toBeDisabled());
    expect(screen.getByText('Ohne Netz nicht möglich')).toBeInTheDocument();
  });

  it('blendet „Erneut senden“ ohne Schreibrecht aus', async () => {
    liste([versand({ id: 'c', state: 'fehlgeschlagen', error: 'abgelehnt' })]);
    renderMitProviders(<Versandliste einsatzId={1} quelle={quelle} darfSchreiben={false} />);
    await screen.findByText(/fehlgeschlagen/);
    expect(screen.queryByRole('button', { name: 'Erneut senden' })).toBeNull();
  });

  it('zeigt Fax-Zustände: geprüft, zugestellt, nicht zugestellt, ohne PDF (LLH-2095)', async () => {
    liste([
      versand({
        id: 'f1',
        channel: 'fax',
        address: '+49511123456',
        state: 'uebergeben',
        handed_over_at: '2026-11-24 13:32:00',
      }),
      versand({
        id: 'f2',
        channel: 'fax',
        state: 'zugestellt',
        handed_over_at: '2026-11-24 13:32:00',
        delivered_at: '2026-11-24 13:34:00',
      }),
      versand({ id: 'f3', channel: 'fax', state: 'fehlgeschlagen', error: 'nicht_zugestellt' }),
      versand({ id: 'f4', channel: 'fax', state: 'fehlgeschlagen', error: 'abgelehnt' }),
      versand({
        id: 'm1',
        state: 'uebergeben',
        handed_over_at: '2026-11-24 13:32:00',
        without_pdf: true,
      }),
    ]);
    renderMitProviders(<Versandliste einsatzId={1} quelle={quelle} />);
    expect(
      await screen.findByText(/^übergeben \d{2}:?\d{2}, Zustellung wird geprüft$/),
    ).toBeInTheDocument();
    expect(screen.getByText(/^zugestellt \d{2}:?\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText('fehlgeschlagen: Fax nicht zugestellt')).toBeInTheDocument();
    expect(screen.getByText('fehlgeschlagen: Von sipgate abgelehnt')).toBeInTheDocument();
    expect(screen.getByText(/^übergeben \d{2}:?\d{2} · ohne PDF$/)).toBeInTheDocument();
    expect(screen.getByText(/ILS Nord · Fax \+49511123456/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Erneut senden' })).toHaveLength(2);
  });
});
