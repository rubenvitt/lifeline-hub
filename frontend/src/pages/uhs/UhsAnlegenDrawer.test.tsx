import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import BrAnlegenDrawer from '../bereitstellungsraum/BrAnlegenDrawer';
import UhsAnlegenDrawer from './UhsAnlegenDrawer';

/**
 * Standort beim Anlegen einer UHS und eines Bereitstellungsraums als Ortsfeld (LLH-1114, Spec
 * `ortsfeld`): ein Treffer oder eine getippte Koordinate geht mit Text und Koordinate in den POST,
 * Freitext nur als Text. Mutationsprobe: die Koordinate nicht abbilden → rot in „… Koordinate …“.
 */

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests (`anzeige/Kartenausschnitt.test.tsx`).
vi.mock('../../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({
    punkt,
    etikett,
  }: {
    punkt: { lat: number; lon: number } | null;
    etikett: string;
  }) => (
    <div role="group" aria-label={`Karte: ${etikett}`}>
      {punkt && `${punkt.lat},${punkt.lon}`}
    </div>
  ),
}));

const TREFFER = {
  zustand: 'ok',
  treffer: [
    { lat: 53.0775, lon: 8.81, name: 'Turnhalle Nord, Musterstadt', kurz: 'Turnhalle Nord' },
  ],
};

beforeEach(() => {
  server.use(
    http.get('/api/einsaetze/:eid', ({ params }) =>
      HttpResponse.json({ id: Number(params.eid), einsatzort_lat: 52.1, einsatzort_lon: 8.6 }),
    ),
    http.get('/api/einsaetze/:eid/ort-vorschau', () =>
      HttpResponse.json({ ortsname: null, peilung: null }),
    ),
    http.get('/api/einsaetze/:eid/ort-suche', () => HttpResponse.json(TREFFER)),
  );
});

function mitschnitt(pfad: string) {
  const rumpfe: Record<string, unknown>[] = [];
  server.use(
    http.post(pfad, async ({ request }) => {
      rumpfe.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 9, einsatz_id: 1, bezeichnung: 'X' }, { status: 201 });
    }),
  );
  return rumpfe;
}

describe.each([
  {
    was: 'UHS',
    pfad: '/api/einsaetze/1/uhs',
    zeige: () => renderMitProviders(<UhsAnlegenDrawer einsatzId={1} open onClose={vi.fn()} />),
  },
  {
    was: 'Bereitstellungsraum',
    pfad: '/api/einsaetze/1/bereitstellungsraeume',
    zeige: () => renderMitProviders(<BrAnlegenDrawer einsatzId={1} open onClose={vi.fn()} />),
  },
])('$was anlegen · Standort als Ortsfeld (LLH-1114)', ({ pfad, zeige }) => {
  it('ein Treffer schickt Standort und Koordinate mit', async () => {
    const rumpfe = mitschnitt(pfad);
    zeige();
    await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'Nord');
    await userEvent.type(screen.getByLabelText('Standort (optional)'), 'Turnhalle{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Turnhalle Nord/ }));
    expect(screen.getByRole('group', { name: 'Karte: Standort' })).toHaveTextContent(
      '53.0775,8.81',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toMatchObject({
      bezeichnung: 'Nord',
      standort: 'Turnhalle Nord',
      lat: 53.0775,
      lon: 8.81,
    });
  });

  it('eine getippte Koordinate geht ohne Suche als Punkt mit', async () => {
    const rumpfe = mitschnitt(pfad);
    zeige();
    await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'Nord');
    await userEvent.type(screen.getByLabelText('Standort (optional)'), '53.07750, 8.81000');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toMatchObject({ standort: '53.07750, 8.81000', lat: 53.0775, lon: 8.81 });
  });

  it('Freitext schickt nur den Standort, ohne Standort nichts davon', async () => {
    const rumpfe = mitschnitt(pfad);
    zeige();
    await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'Nord');
    await userEvent.type(screen.getByLabelText('Standort (optional)'), 'Hinter der Halle');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0].standort).toBe('Hinter der Halle');
    expect(rumpfe[0]).not.toHaveProperty('lat');
    expect(rumpfe[0]).not.toHaveProperty('lon');
  });
});
