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

function handler(opts: { kandidaten?: unknown[]; pflicht?: boolean } = {}) {
  server.use(
    http.get('/api/incidents/7/vehicles/10/tracking/candidates', () =>
      HttpResponse.json({
        volunteer_crew_required: opts.pflicht ?? true,
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

  it('verlangt bei Pflicht die Bestätigung „Besatzung ist ehrenamtlich“', async () => {
    handler({ pflicht: true });
    render();
    await userEvent.click(await screen.findByRole('radio', { name: /kennung-a/ }));
    const koppeln = screen.getByRole('button', { name: 'Koppeln' });
    expect(koppeln).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Besatzung ist ehrenamtlich' }));
    expect(koppeln).toBeEnabled();
    await userEvent.click(koppeln);
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(bodies).toEqual([
      { access_id: 'z1', device_id: 'kennung-a', volunteer_crew_confirmed: true },
    ]);
  });

  it('zeigt das Kästchen nicht, wenn die Bestätigung nicht Pflicht ist, und koppelt ohne Bestätigung', async () => {
    handler({ pflicht: false });
    render();
    await userEvent.click(await screen.findByRole('radio', { name: /kennung-a/ }));
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Besatzung ist ehrenamtlich' })).toBeNull(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(bodies).toEqual([
      { access_id: 'z1', device_id: 'kennung-a', volunteer_crew_confirmed: false },
    ]);
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

  it('holt bei 422 `volunteer_crew_required` die Kandidaten neu: das Kästchen erscheint, der Dialog bleibt offen', async () => {
    let pflicht = false;
    server.use(
      http.get('/api/incidents/7/vehicles/10/tracking/candidates', () =>
        HttpResponse.json({ volunteer_crew_required: pflicht, candidates: KANDIDATEN }),
      ),
      http.put('/api/incidents/7/vehicles/10/tracking', () => {
        pflicht = true;
        return HttpResponse.json(
          {
            error: 'Die ehrenamtliche Besatzung muss bestätigt werden',
            grund: 'volunteer_crew_required',
          },
          { status: 422 },
        );
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('radio', { name: /kennung-a/ }));
    expect(screen.queryByRole('checkbox', { name: 'Besatzung ist ehrenamtlich' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
    expect(
      await screen.findByRole('checkbox', { name: 'Besatzung ist ehrenamtlich' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/muss bestätigt werden/)).toBeInTheDocument();
    expect(onSchliessen).not.toHaveBeenCalled();
  });

  it('holt bei 409 (Kennung vergeben) die Kandidaten neu, bleibt offen und nennt den Zustand', async () => {
    let vergeben = false;
    server.use(
      http.get('/api/incidents/7/vehicles/10/tracking/candidates', () =>
        HttpResponse.json({
          volunteer_crew_required: false,
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
