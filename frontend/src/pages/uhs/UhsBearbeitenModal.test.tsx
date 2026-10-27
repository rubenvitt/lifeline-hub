import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Uhs } from '../../api/types';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import UhsBearbeitenModal, { uhsPatchAus } from './UhsBearbeitenModal';

/**
 * Stammdaten der UHS bearbeiten (LLH-1407, Muster `BrBearbeitenModal`): der PATCH trägt nur, was
 * sich gegen den Stand beim Öffnen geändert hat; der Standort ist ein Ortsfeld, Text und
 * Koordinate gehen gemeinsam hinaus, ein geleerter Standort leert beide.
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

const basis = {
  id: 9,
  einsatz_id: 1,
  bezeichnung: 'BHP 50',
  typ: 'behandlungsplatz',
  status: 'aktiv',
  standort: 'Halle 1',
  notiz: null,
  lat: 53.0775,
  lon: 8.81,
} as unknown as Uhs;
const punkt = { lat: 53.0775, lon: 8.81 };

describe('uhsPatchAus · Teil-Patch gegen den Stand beim Öffnen', () => {
  it('Textkorrektur am verorteten Standort: nur der Text geht hinaus', () => {
    expect(
      uhsPatchAus(basis, {
        bezeichnung: 'BHP 50',
        standort: { text: 'Halle 2', koordinate: punkt, quelle: 'karte' },
      }),
    ).toEqual({ standort: 'Halle 2' });
  });

  it('ein neuer Punkt geht als Paar hinaus, der Text bleibt draußen', () => {
    expect(
      uhsPatchAus(basis, {
        bezeichnung: 'BHP 50',
        standort: { text: 'Halle 1', koordinate: { lat: 53.1, lon: 8.82 }, quelle: 'karte' },
      }),
    ).toEqual({ lat: 53.1, lon: 8.82 });
  });

  it('geleerter Standort leert Text und Koordinate', () => {
    expect(
      uhsPatchAus(basis, { bezeichnung: 'BHP 50', standort: { text: ' ', koordinate: punkt } }),
    ).toEqual({ standort: null, lat: null, lon: null });
  });

  it('unverändert: leerer Patch', () => {
    expect(
      uhsPatchAus(basis, {
        bezeichnung: ' BHP 50 ',
        standort: { text: 'Halle 1', koordinate: punkt, quelle: 'karte' },
        notiz: '  ',
      }),
    ).toEqual({});
  });
});

const TREFFER = {
  zustand: 'ok',
  treffer: [{ lat: 52.5, lon: 8.7, name: 'Turnhalle Nord, Musterstadt', kurz: 'Turnhalle Nord' }],
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

function mitschnitt() {
  const rumpfe: Record<string, unknown>[] = [];
  server.use(
    http.patch('/api/einsaetze/1/uhs/9', async ({ request }) => {
      rumpfe.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ ...basis });
    }),
  );
  return rumpfe;
}

function zeige(uhs: Uhs = basis) {
  const onClose = vi.fn();
  renderMitProviders(<UhsBearbeitenModal einsatzId={1} uhs={uhs} offen onClose={onClose} />);
  return onClose;
}

describe('UhsBearbeitenModal · PATCH aus dem Formular (LLH-1407)', () => {
  it('nur Geändertes geht hinaus: eine neue Notiz lässt Bezeichnung und Standort draußen', async () => {
    const rumpfe = mitschnitt();
    const onClose = zeige();
    expect(
      await screen.findByRole('dialog', { name: 'Unfallhilfsstelle bearbeiten' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue('BHP 50'));
    await userEvent.type(screen.getByLabelText('Notiz (optional)'), 'Zugang über Tor 3');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toEqual({ notiz: 'Zugang über Tor 3' });
    expect(await screen.findByText('Unfallhilfsstelle gespeichert')).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('ein Treffer der Ortssuche schickt Standort und Koordinate mit', async () => {
    const rumpfe = mitschnitt();
    zeige({ ...basis, lat: null, lon: null } as Uhs);
    const feld = await screen.findByLabelText('Standort (optional)');
    await waitFor(() => expect(feld).toHaveValue('Halle 1'));
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Turnhalle{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Turnhalle Nord/ }));
    expect(screen.getByRole('group', { name: 'Karte: Standort' })).toHaveTextContent('52.5,8.7');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toEqual({ standort: 'Turnhalle Nord', lat: 52.5, lon: 8.7 });
  });

  it('ein geleerter Standort leert Text und Koordinate mit null', async () => {
    const rumpfe = mitschnitt();
    zeige();
    const feld = await screen.findByLabelText('Standort (optional)');
    await waitFor(() => expect(feld).toHaveValue('Halle 1'));
    await userEvent.clear(feld);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toEqual({ standort: null, lat: null, lon: null });
  });

  it('ohne Änderung geht nichts an den Server', async () => {
    const rumpfe = mitschnitt();
    const onClose = zeige();
    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue('BHP 50'));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(rumpfe).toHaveLength(0);
  });
});
