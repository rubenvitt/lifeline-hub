import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben, VerpflegungVorlage, VerpflegungZeitfenster } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';
import { adminFixture, benutzerFixture, freigabenFixture } from '../test/fixtures';
import { mitProzessZone } from '../test/prozessZone';
import { meHandler, server } from '../test/server';
import { zeitfenster } from '../test/verpflegungDaten';
import { verpflegungsplan } from '../test/verpflegungVorlageDaten';
import type { BedarfsvorschlagArgs } from './useBedarfsvorschlag';

dayjs.extend(utc);
dayjs.extend(timezone);

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
  freigaben: {} as ModulFreigaben,
}));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
  ladeModulFreigaben: vi.fn(() => Promise.resolve(einsatz.freigaben)),
}));

const ladeVerpflegung = vi.fn();
const createTagAusVorlage = vi.fn();
vi.mock('../api/verpflegung', () => ({
  ladeVerpflegung: (...a: unknown[]) => ladeVerpflegung(...a),
  createTagAusVorlage: (...a: unknown[]) => createTagAusVorlage(...a),
}));

const listVerpflegungVorlagen = vi.fn();
vi.mock('../api/verpflegungVorlagen', () => ({
  listVerpflegungVorlagen: (...a: unknown[]) => listVerpflegungVorlagen(...a),
}));

/**
 * Der Vorschlag selbst ist in `useBedarfsvorschlag.test.tsx` geprüft; hier zählt, dass jedes
 * Fenster ihn zu SEINEM Beginn fragt und ihn so übernimmt wie der Zeitfensterdialog. Kräfte immer
 * 186; Betreute nur zum Beginn von „Mittag“ (12:00 Berlin), sonst „keine Belegung gemeldet“.
 */
const gefragt: (string | undefined)[] = [];
vi.mock('./useBedarfsvorschlag', () => ({
  useBedarfsvorschlag: ({ vonAt }: BedarfsvorschlagArgs) => {
    gefragt.push(vonAt);
    return {
      kraefte: { wert: 186, hinweis: 'Vorschlag: Personal im Einsatz, Stand 12:30' },
      betreute:
        vonAt === '2026-10-11 10:00:00'
          ? { wert: 70, hinweis: 'Vorschlag: in Betreuung zum Beginn' }
          : { wert: null, hinweis: 'keine Belegung gemeldet' },
    };
  },
}));

vi.mock('../abloesung/useUhr', () => ({ useUhr: () => dayjs.utc('2026-10-10 10:30:00') }));

const { default: TagAusVorlage } = await import('./TagAusVorlage');

function Ort() {
  const l = useLocation();
  return <div data-testid="ort">{l.pathname + l.search}</div>;
}

function renderSeite({
  adresse = '/einsaetze/1/verpflegung/aus-vorlage?tag=2026-10-11',
  benutzer = benutzerFixture({ id: 1 }),
}: { adresse?: string; benutzer?: ReturnType<typeof benutzerFixture> } = {}) {
  server.use(meHandler(benutzer));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <AnzeigeKonventionenProvider
            konventionen={{
              zeitzone: 'Europe/Berlin',
              zeitformat: null,
              einheiten: null,
              koordinatenformat: null,
            }}
          >
            <MemoryRouter initialEntries={[adresse]}>
              <Routes>
                <Route path="/einsaetze/:id/verpflegung/aus-vorlage" element={<TagAusVorlage />} />
                <Route path="/einsaetze/:id/verpflegung" element={<Ort />} />
              </Routes>
            </MemoryRouter>
          </AnzeigeKonventionenProvider>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return { client };
}

/** Das Paneel eines Fensters (Augenbraue = Bezeichnung). */
const fenster = (bezeichnung: string) => screen.findByRole('region', { name: bezeichnung });
const anlegenKnopf = () => screen.getByRole('button', { name: 'Zeitfenster anlegen' });

function liefert(
  bestand: VerpflegungZeitfenster[] = [],
  plan: VerpflegungVorlage[] = verpflegungsplan(),
) {
  ladeVerpflegung.mockResolvedValue({ zeitfenster: bestand, stellen: [] });
  listVerpflegungVorlagen.mockResolvedValue(plan);
}

describe('Tag aus Vorlage anlegen (LLH-1058) — Browser UTC, Anzeigezone Berlin', () => {
  mitProzessZone('UTC');

  beforeEach(() => {
    vi.clearAllMocks();
    gefragt.length = 0;
    einsatz.wert = {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    };
    einsatz.freigaben = freigabenFixture();
    liefert();
    createTagAusVorlage.mockImplementation((_id: number, body: { zeitfenster: unknown[] }) =>
      Promise.resolve({
        angelegt: body.zeitfenster.map((_, i) => zeitfenster({ id: 100 + i })),
        uebersprungen: [],
      }),
    );
  });

  it('zeigt jede aktive Mahlzeit am gewählten Tag in Berliner Zeit, die Nacht bis zum Folgetag', async () => {
    renderSeite();
    const f = await fenster('Frühstück');
    expect(within(f).getByText('11.10. 06:30–08:00')).toBeInTheDocument();
    expect(
      within(await fenster('Nachtverpflegung')).getByText('11.10. 23:00–12.10. 01:00'),
    ).toBeInTheDocument();
    expect(within(await fenster('Mittag')).getByText(/warm/)).toBeInTheDocument();
    expect(listVerpflegungVorlagen).toHaveBeenCalledWith('aktiv');
  });

  it('belegt den Bedarf je Fenster vor, mit Herkunft; ohne Quelle bleibt das Feld leer, nie 0', async () => {
    renderSeite();
    const mittag = await fenster('Mittag');
    await waitFor(() =>
      expect(within(mittag).getByLabelText('Einsatzkräfte (EP) zu Mittag')).toHaveValue('186'),
    );
    expect(within(mittag).getByLabelText('Betreute (EP) zu Mittag')).toHaveValue('70');
    expect(within(mittag).getByText('Vorschlag: in Betreuung zum Beginn')).toBeInTheDocument();
    expect(
      within(mittag).getByText('Vorschlag: Personal im Einsatz, Stand 12:30'),
    ).toBeInTheDocument();
    const fruehstueck = await fenster('Frühstück');
    expect(within(fruehstueck).getByLabelText('Betreute (EP) zu Frühstück')).toHaveValue('');
    expect(within(fruehstueck).getByText('keine Belegung gemeldet')).toBeInTheDocument();
    // Die Kopfzahl wird zum Beginn jedes Fensters gefragt (UTC am Draht).
    expect(gefragt).toEqual(
      expect.arrayContaining([
        '2026-10-11 04:30:00',
        '2026-10-11 10:00:00',
        '2026-10-11 16:00:00',
        '2026-10-11 21:00:00',
      ]),
    );
  });

  it('legt die gewählten Fenster an: UTC-Zeiten, Tagesgrenzen, Rückmeldung und zurück zur Seite', async () => {
    const user = userEvent.setup();
    renderSeite();
    const nacht = await fenster('Nachtverpflegung');
    await user.click(within(nacht).getByRole('checkbox', { name: 'Nachtverpflegung anlegen' }));
    for (const name of ['Frühstück', 'Abendessen']) {
      const feld = within(await fenster(name)).getByLabelText(`Betreute (EP) zu ${name}`);
      await user.type(feld, '0');
    }
    // Eine überschriebene Zahl gilt, nicht der Vorschlag.
    const kraefte = within(await fenster('Mittag')).getByLabelText('Einsatzkräfte (EP) zu Mittag');
    await user.clear(kraefte);
    await user.type(kraefte, '200');
    expect(screen.getByText('3 Zeitfenster am 11.10.')).toBeInTheDocument();
    await user.click(anlegenKnopf());

    await waitFor(() => expect(createTagAusVorlage).toHaveBeenCalledTimes(1));
    expect(createTagAusVorlage).toHaveBeenCalledWith(1, {
      tag_von_at: '2026-10-10 22:00:00',
      tag_bis_at: '2026-10-11 22:00:00',
      zeitfenster: [
        {
          bezeichnung: 'Frühstück',
          von_at: '2026-10-11 04:30:00',
          bis_at: '2026-10-11 06:00:00',
          bedarf_kraefte: 186,
          bedarf_betreute: 0,
        },
        {
          bezeichnung: 'Mittag',
          von_at: '2026-10-11 10:00:00',
          bis_at: '2026-10-11 11:30:00',
          bedarf_kraefte: 200,
          bedarf_betreute: 70,
          verpflegungsart: 'warm',
        },
        {
          bezeichnung: 'Abendessen',
          von_at: '2026-10-11 16:00:00',
          bis_at: '2026-10-11 17:30:00',
          bedarf_kraefte: 186,
          bedarf_betreute: 0,
        },
      ],
    });
    expect(await screen.findByText('3 Zeitfenster für den 11.10. angelegt')).toBeInTheDocument();
    expect(await screen.findByTestId('ort')).toHaveTextContent('/einsaetze/1/verpflegung');
  });

  it('ein Bedarfsfeld ohne Quelle muss gefüllt werden; ein abgewähltes nicht', async () => {
    const user = userEvent.setup();
    renderSeite();
    await fenster('Frühstück');
    await user.click(anlegenKnopf());
    expect(await screen.findAllByText('Bitte eine Anzahl angeben — 0, wenn niemand')).toHaveLength(
      3,
    );
    // Abgewählt ist die Nacht kein Pflichtfeld mehr.
    const nacht = await fenster('Nachtverpflegung');
    await user.click(within(nacht).getByRole('checkbox', { name: 'Nachtverpflegung anlegen' }));
    await user.click(anlegenKnopf());
    await waitFor(() =>
      expect(screen.getAllByText('Bitte eine Anzahl angeben — 0, wenn niemand')).toHaveLength(2),
    );
    expect(createTagAusVorlage).not.toHaveBeenCalled();
  });

  it('ein am Tag schon angelegtes Fenster steht als vorhanden und geht nicht hinaus; die Quittung nennt Übersprungenes', async () => {
    liefert([
      zeitfenster({
        id: 7,
        bezeichnung: 'mittag',
        von_at: '2026-10-11 10:00:00',
        bis_at: '2026-10-11 11:30:00',
      }),
    ]);
    createTagAusVorlage.mockResolvedValue({
      angelegt: [zeitfenster({ id: 101 })],
      uebersprungen: ['Abendessen'],
    });
    const user = userEvent.setup();
    renderSeite();
    const mittag = await fenster('Mittag');
    expect(within(mittag).getByText('schon angelegt')).toBeInTheDocument();
    expect(within(mittag).queryByRole('checkbox')).toBeNull();
    expect(within(mittag).queryByLabelText('Betreute (EP) zu Mittag')).toBeNull();
    for (const name of ['Frühstück', 'Abendessen', 'Nachtverpflegung']) {
      await user.type(within(await fenster(name)).getByLabelText(`Betreute (EP) zu ${name}`), '5');
    }
    await user.click(anlegenKnopf());
    await waitFor(() => expect(createTagAusVorlage).toHaveBeenCalledTimes(1));
    const body = createTagAusVorlage.mock.calls[0][1] as { zeitfenster: { bezeichnung: string }[] };
    expect(body.zeitfenster.map((z) => z.bezeichnung)).toEqual([
      'Frühstück',
      'Abendessen',
      'Nachtverpflegung',
    ]);
    expect(
      await screen.findByText(
        '1 Zeitfenster für den 11.10. angelegt · am Tag schon vorhanden: ‚Abendessen‘',
      ),
    ).toBeInTheDocument();
  });

  it('ein live hinzukommendes Zeitfenster verschiebt die Vorschau nicht; der Server überspringt es', async () => {
    createTagAusVorlage.mockResolvedValue({
      angelegt: [zeitfenster({ id: 101 }), zeitfenster({ id: 102 }), zeitfenster({ id: 103 })],
      uebersprungen: ['Mittag'],
    });
    const user = userEvent.setup();
    const { client } = renderSeite();
    const mittag = await fenster('Mittag');
    // Jemand anderes legt „Mittag“ für diesen Tag an (Live-Ereignis `verpflegung`).
    client.setQueryData(einsatzKeys.verpflegung(1), {
      zeitfenster: [
        zeitfenster({
          id: 7,
          bezeichnung: 'Mittag',
          von_at: '2026-10-11 10:00:00',
          bis_at: '2026-10-11 11:30:00',
        }),
      ],
      stellen: [],
    });
    await waitFor(() => expect(client.getQueryData(einsatzKeys.verpflegung(1))).toBeTruthy());
    // Die Felder unter dem Cursor bleiben stehen.
    expect(within(mittag).getByLabelText('Betreute (EP) zu Mittag')).toBeInTheDocument();
    expect(within(mittag).queryByText('schon angelegt')).toBeNull();
    for (const name of ['Frühstück', 'Abendessen', 'Nachtverpflegung']) {
      await user.type(within(await fenster(name)).getByLabelText(`Betreute (EP) zu ${name}`), '0');
    }
    await user.click(anlegenKnopf());
    expect(
      await screen.findByText(
        '3 Zeitfenster für den 11.10. angelegt · am Tag schon vorhanden: ‚Mittag‘',
      ),
    ).toBeInTheDocument();
  });

  it('eine Ablehnung steht auf der Seite, und die Seite bleibt', async () => {
    createTagAusVorlage.mockRejectedValue(
      new ApiError(422, 'Zeitfenster 2 (Mittag): Sonderkost übersteigt den Gesamtbedarf'),
    );
    const user = userEvent.setup();
    renderSeite();
    for (const name of ['Frühstück', 'Abendessen', 'Nachtverpflegung']) {
      await user.type(within(await fenster(name)).getByLabelText(`Betreute (EP) zu ${name}`), '1');
    }
    await user.click(anlegenKnopf());
    expect(
      await screen.findByText('Zeitfenster 2 (Mittag): Sonderkost übersteigt den Gesamtbedarf'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('ort')).toBeNull();
  });

  it('ohne Schreibrecht: Grund sichtbar, Anlegen gesperrt', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderSeite();
    await fenster('Frühstück');
    expect(screen.getByText('Nur Ansicht')).toBeInTheDocument();
    expect(anlegenKnopf()).toBeDisabled();
  });

  it('leerer Plan: der Admin bekommt den Weg in die Verwaltung, sonst nur den Zustand', async () => {
    liefert([], []);
    renderSeite({ benutzer: adminFixture() });
    expect(await screen.findByText('Kein Verpflegungsplan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verpflegungsplan öffnen' })).toBeInTheDocument();
  });

  it('leerer Plan ohne Admin-Recht: kein Weg in die Verwaltung', async () => {
    liefert([], []);
    renderSeite();
    expect(await screen.findByText('Kein Verpflegungsplan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verpflegungsplan öffnen' })).toBeNull();
  });

  it('ohne `?tag=` gilt heute in der Anzeigezone', async () => {
    renderSeite({ adresse: '/einsaetze/1/verpflegung/aus-vorlage' });
    const heute = dayjs().tz('Europe/Berlin').format('DD.MM.');
    const f = await fenster('Frühstück');
    expect(within(f).getByText(`${heute} 06:30–08:00`)).toBeInTheDocument();
  });
});
