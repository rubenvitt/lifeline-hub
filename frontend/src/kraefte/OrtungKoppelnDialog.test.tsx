import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { EinsatzFahrzeug } from '../api/types';
import OrtungKoppelnDialog from './OrtungKoppelnDialog';

const FAHRZEUG = { id: 10, funkrufname: 'Florian 1' } as EinsatzFahrzeug;

const VOR_2_MIN = new Date(Date.now() - 2 * 60_000).toISOString();

const KANDIDATEN = [
  {
    access_id: 'z1',
    access_name: 'Tracker-Gateway',
    device_id: 'kennung-a',
    received_at: VOR_2_MIN,
    coupled: false,
  },
  {
    access_id: 'z1',
    access_name: 'Tracker-Gateway',
    device_id: 'kennung-b',
    received_at: VOR_2_MIN,
    coupled: true,
  },
];

let bodies: unknown[];
let onSchliessen: () => void;

function handler(opts: { kandidaten?: unknown[]; schalter?: boolean } = {}) {
  server.use(
    http.get('/api/incidents/7/vehicles/10/tracking/candidates', () =>
      HttpResponse.json({
        tracking_enabled: opts.schalter ?? true,
        candidates: opts.kandidaten ?? KANDIDATEN,
      }),
    ),
    http.put('/api/incidents/7/vehicles/10/tracking', async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ ...FAHRZEUG, ortung_gekoppelt: true });
    }),
  );
}

beforeEach(() => {
  bodies = [];
  onSchliessen = vi.fn();
});

function render() {
  return renderMitProviders(
    <OrtungKoppelnDialog einsatzId={7} fahrzeug={FAHRZEUG} onSchliessen={onSchliessen} />,
  );
}

describe('OrtungKoppelnDialog', () => {
  it('zeigt die Kennungen als „Zugang · Kennung · vor 2 min“ und sperrt gekoppelte', async () => {
    handler();
    render();
    const frei = await screen.findByRole('radio', {
      name: 'Tracker-Gateway · kennung-a · vor 2 min',
    });
    expect(frei).toBeEnabled();
    expect(
      screen.getByRole('radio', { name: 'Tracker-Gateway · kennung-b · vor 2 min' }),
    ).toBeDisabled();
  });

  it('koppelt die gewählte Kennung ohne weitere Bestätigung', async () => {
    handler();
    render();
    await userEvent.click(await screen.findByRole('radio', { name: /kennung-a/ }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(bodies).toEqual([{ access_id: 'z1', device_id: 'kennung-a' }]);
  });

  it('erklärt bei ausgeschaltetem Org-Schalter, warum Koppeln gesperrt ist', async () => {
    handler({ schalter: false });
    render();
    expect(
      await screen.findByText(/Ortung ist für diese Organisation ausgeschaltet/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Verwaltung → Einsatz-Vorgaben/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Koppeln' })).toBeDisabled();
  });

  it('nennt ohne Kennungen den Zustand und lässt nicht koppeln', async () => {
    handler({ kandidaten: [] });
    render();
    expect(
      await screen.findByText('Keine Position in den letzten 24 Stunden eingegangen.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Koppeln' })).toBeDisabled();
  });

  it('holt bei 422 (Org-Schalter inzwischen aus) die Kandidaten neu, erklärt die Sperre und bleibt offen', async () => {
    let schalter = true;
    server.use(
      http.get('/api/incidents/7/vehicles/10/tracking/candidates', () =>
        HttpResponse.json({ tracking_enabled: schalter, candidates: KANDIDATEN }),
      ),
      http.put('/api/incidents/7/vehicles/10/tracking', () => {
        schalter = false;
        return HttpResponse.json(
          {
            error:
              'Ortung ist für diese Organisation ausgeschaltet (Verwaltung → Einsatz-Vorgaben)',
          },
          { status: 422 },
        );
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('radio', { name: /kennung-a/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
    await waitFor(() => expect(screen.queryByRole('radio')).toBeNull());
    expect(screen.getByRole('button', { name: 'Koppeln' })).toBeDisabled();
    expect(onSchliessen).not.toHaveBeenCalled();
  });

  it('holt bei 409 (Kennung vergeben) die Kandidaten neu, bleibt offen und nennt den Zustand', async () => {
    let vergeben = false;
    server.use(
      http.get('/api/incidents/7/vehicles/10/tracking/candidates', () =>
        HttpResponse.json({
          tracking_enabled: true,
          candidates: KANDIDATEN.map((k) =>
            k.device_id === 'kennung-a' ? { ...k, coupled: vergeben } : k,
          ),
        }),
      ),
      http.put('/api/incidents/7/vehicles/10/tracking', () => {
        vergeben = true;
        return HttpResponse.json({ error: 'Kennung ist bereits gekoppelt' }, { status: 409 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('radio', { name: /kennung-a/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
    expect(await screen.findByText(/bereits gekoppelt/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: /kennung-a/ })).toBeDisabled());
    expect(onSchliessen).not.toHaveBeenCalled();
  });
});
