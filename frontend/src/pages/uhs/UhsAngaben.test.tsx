import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Uhs } from '../../api/types';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { QueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import UhsAngaben from './UhsAngaben';

/**
 * Paneel „Angaben“ der UHS (LLH-1920, Spec `uhs-bearbeitung`): Stammdaten in der Ansicht
 * bearbeiten, nur Geändertes mit Basisstand, 409 als Rückfrage.
 */

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests (`anzeige/Kartenausschnitt.test.tsx`).
vi.mock('../../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({ etikett }: { etikett: string }) => (
    <div role="group" aria-label={`Karte: ${etikett}`} />
  ),
}));

const basis = {
  id: 9,
  einsatz_id: 1,
  bezeichnung: 'BHP 50',
  typ: 'behandlungsplatz',
  status: 'aktiv',
  standort: 'Halle 3',
  notiz: null,
  lat: null,
  lon: null,
  soll_anzahl: 6,
  quali_soll: [{ qualifikation_id: 2, label: 'Rettungssanitäter', anzahl: 1 }],
  geaendert_at: 's1',
} as unknown as Uhs;

const TREFFER = {
  zustand: 'ok',
  treffer: [{ lat: 52.5, lon: 8.7, name: 'Turnhalle Nord, Musterstadt', kurz: 'Turnhalle Nord' }],
};

beforeEach(() => {
  server.use(
    http.get('/api/incidents/:eid', ({ params }) =>
      HttpResponse.json({ id: Number(params.eid), einsatzort_lat: 52.1, einsatzort_lon: 8.6 }),
    ),
    http.get('/api/incidents/:eid/place-preview', () =>
      HttpResponse.json({ ortsname: null, peilung: null }),
    ),
    http.get('/api/incidents/:eid/place-search', () => HttpResponse.json(TREFFER)),
    http.get('/api/qualifications', () =>
      HttpResponse.json([{ id: 2, label: 'Rettungssanitäter', aktiv: true }]),
    ),
  );
});

function mitschnitt(antwort?: (n: number) => Response | undefined) {
  const rumpfe: Record<string, unknown>[] = [];
  server.use(
    http.patch('/api/incidents/1/uhs/9', async ({ request }) => {
      rumpfe.push((await request.json()) as Record<string, unknown>);
      return antwort?.(rumpfe.length) ?? HttpResponse.json({ ...basis });
    }),
  );
  return rumpfe;
}

function zeige(uhs: Uhs = basis, bearbeitbar = true) {
  const onNeuLaden = vi.fn();
  renderMitProviders(
    <UhsAngaben einsatzId={1} uhs={uhs} bearbeitbar={bearbeitbar} onNeuLaden={onNeuLaden} />,
    { datenRouter: true },
  );
  return onNeuLaden;
}

const paneel = () => screen.getByRole('region', { name: 'Angaben' });
const oeffne = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Angaben bearbeiten' }));

describe('UhsAngaben · Lesen', () => {
  it('zeigt die Stammdaten, Leeres als „—“', () => {
    zeige();
    const p = paneel();
    expect(within(p).getByText('BHP 50')).toBeInTheDocument();
    expect(within(p).getByText('Halle 3')).toBeInTheDocument();
    expect(within(p).getByText('6')).toBeInTheDocument();
    expect(within(p).getByText('mind. 1 Rettungssanitäter')).toBeInTheDocument();
    expect(within(p).getByText('—')).toBeInTheDocument();
  });

  it('nicht bearbeitbar: kein „Bearbeiten“', () => {
    zeige(basis, false);
    expect(within(paneel()).getByText('BHP 50')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Angaben bearbeiten' })).toBeNull();
  });
});

describe('UhsAngaben · Speichern', () => {
  it('nur die geänderte Soll-Anzahl mit Basisstand, danach wieder Lesezustand', async () => {
    const rumpfe = mitschnitt();
    zeige();
    await oeffne();
    // Kein Dialog: das Paneel selbst wird zu Eingaben.
    expect(screen.queryByRole('dialog')).toBeNull();
    const soll = within(paneel()).getByLabelText('Soll-Anzahl');
    await waitFor(() => expect(soll).toHaveValue('6'));
    await userEvent.clear(soll);
    await userEvent.type(soll, '8');
    await userEvent.click(within(paneel()).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpfe).toEqual([{ soll_anzahl: 8, basis_geaendert_at: 's1' }]));
    expect(await screen.findByText('Unfallhilfsstelle gespeichert')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Angaben bearbeiten' })).toBeInTheDocument();
  });

  it('Notiz eingetragen: nur die Notiz geht hinaus', async () => {
    const rumpfe = mitschnitt();
    zeige();
    await oeffne();
    await userEvent.type(within(paneel()).getByLabelText('Notiz'), 'Zugang über Tor B');
    await userEvent.click(within(paneel()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(rumpfe).toEqual([{ notiz: 'Zugang über Tor B', basis_geaendert_at: 's1' }]),
    );
  });

  it('Notiz geleert geht als null hinaus', async () => {
    const rumpfe = mitschnitt();
    zeige({ ...basis, notiz: 'Tor B' } as Uhs);
    await oeffne();
    await userEvent.clear(within(paneel()).getByLabelText('Notiz'));
    await userEvent.click(within(paneel()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(rumpfe).toEqual([{ notiz: null, basis_geaendert_at: 's1' }]));
  });

  it('ein Treffer der Ortssuche schickt Standort und Koordinate mit', async () => {
    const rumpfe = mitschnitt();
    zeige();
    await oeffne();
    const feld = within(paneel()).getByLabelText('Standort');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Turnhalle{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Turnhalle Nord/ }));
    await userEvent.click(within(paneel()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(rumpfe).toEqual([
        { standort: 'Turnhalle Nord', lat: 52.5, lon: 8.7, basis_geaendert_at: 's1' },
      ]),
    );
  });

  it('ohne Änderung geht nichts an den Server', async () => {
    const rumpfe = mitschnitt();
    zeige();
    await oeffne();
    // Ohne Änderung ist „Speichern“ gesperrt; Enter schließt das Paneel (LLH-1829).
    expect(within(paneel()).getByRole('button', { name: 'Speichern' })).toBeDisabled();
    await userEvent.type(within(paneel()).getByLabelText('Bezeichnung'), '{Enter}');
    expect(await screen.findByRole('button', { name: 'Angaben bearbeiten' })).toBeInTheDocument();
    expect(rumpfe).toEqual([]);
  });

  it('leere Bezeichnung: Hinweis am Feld, kein PATCH', async () => {
    const rumpfe = mitschnitt();
    zeige();
    await oeffne();
    await userEvent.clear(within(paneel()).getByLabelText('Bezeichnung'));
    await userEvent.click(within(paneel()).getByRole('button', { name: 'Speichern' }));
    expect(await within(paneel()).findByText('Bezeichnung fehlt')).toBeInTheDocument();
    expect(rumpfe).toEqual([]);
  });
});

describe('UhsAngaben · Stand nach dem Speichern', () => {
  it('legt die Antwort des Servers in den Cache der Stelle, vor dem Neuabruf', async () => {
    mitschnitt(() =>
      HttpResponse.json({ ...basis, notiz: 'Tor B', geaendert_at: 's2' } as unknown as Uhs),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(einsatzKeys.uhsDetail(1, 9), { ...basis, plaetze: [] });
    renderMitProviders(<UhsAngaben einsatzId={1} uhs={basis} bearbeitbar onNeuLaden={vi.fn()} />, {
      datenRouter: true,
      client: qc,
    });
    await oeffne();
    await userEvent.type(within(paneel()).getByLabelText('Notiz'), 'Tor B');
    await userEvent.click(within(paneel()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(qc.getQueryData(einsatzKeys.uhsDetail(1, 9))).toMatchObject({
        notiz: 'Tor B',
        geaendert_at: 's2',
        plaetze: [],
      }),
    );
  });
});

describe('UhsAngaben · Konflikt', () => {
  it('409: Rückfrage, „Meine Änderung übernehmen“ sendet ohne Basis', async () => {
    const rumpfe = mitschnitt((n) =>
      n === 1
        ? HttpResponse.json(
            {
              error: 'Der Datensatz wurde zwischenzeitlich geändert. Bitte neu laden.',
              grund: 'veraltet',
            },
            { status: 409 },
          )
        : undefined,
    );
    zeige();
    await oeffne();
    await userEvent.type(within(paneel()).getByLabelText('Notiz'), 'neu');
    await userEvent.click(within(paneel()).getByRole('button', { name: 'Speichern' }));

    const frage = await screen.findByRole('dialog', { name: 'Zwischenzeitlich geändert' });
    await userEvent.click(within(frage).getByRole('button', { name: 'Meine Änderung übernehmen' }));
    await waitFor(() =>
      expect(rumpfe).toEqual([{ notiz: 'neu', basis_geaendert_at: 's1' }, { notiz: 'neu' }]),
    );
  });

  it('„Verwerfen und neu laden“ lädt neu', async () => {
    mitschnitt(() =>
      HttpResponse.json(
        { error: 'Der Datensatz wurde zwischenzeitlich geändert.', grund: 'veraltet' },
        { status: 409 },
      ),
    );
    const onNeuLaden = zeige();
    await oeffne();
    await userEvent.type(within(paneel()).getByLabelText('Notiz'), 'neu');
    await userEvent.click(within(paneel()).getByRole('button', { name: 'Speichern' }));
    const frage = await screen.findByRole('dialog', { name: 'Zwischenzeitlich geändert' });
    await userEvent.click(within(frage).getByRole('button', { name: 'Verwerfen und neu laden' }));
    expect(onNeuLaden).toHaveBeenCalled();
  });

  it('doppelte Bezeichnung (409 ohne Sperrkonflikt): Grund am Paneel, keine Rückfrage', async () => {
    mitschnitt(() =>
      HttpResponse.json(
        { error: 'Eine UHS mit dieser Bezeichnung existiert bereits in diesem Einsatz' },
        { status: 409 },
      ),
    );
    zeige();
    await oeffne();
    const bezeichnung = within(paneel()).getByLabelText('Bezeichnung');
    await userEvent.clear(bezeichnung);
    await userEvent.type(bezeichnung, 'BHP 51');
    await userEvent.click(within(paneel()).getByRole('button', { name: 'Speichern' }));
    expect(await within(paneel()).findByRole('alert')).toHaveTextContent(
      'existiert bereits in diesem Einsatz',
    );
    expect(screen.queryByRole('dialog', { name: 'Zwischenzeitlich geändert' })).toBeNull();
    expect(bezeichnung).toHaveValue('BHP 51');
  });
});
