import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import BetreuungsstelleDetailPage from './BetreuungsstelleDetailPage';
import { AuthProvider } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import type { BetreuungUebersicht, Betreuungsstelle, Person } from '../api/types';
import { queueLeerenFuerTests } from '../offline/queue';
import { meHandler, server } from '../test/server';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { setzeOnline } from '../test/utils';

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
}));
const freigaben = vi.hoisted(() => ({ wert: undefined as unknown }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
  ladeModulFreigaben: vi.fn(() => Promise.resolve(freigaben.wert)),
}));
vi.mock('../api/einsatzabschnitte', () => ({
  listeAbschnitte: vi.fn().mockResolvedValue([{ id: 3, name: 'Deichwache Nord' }]),
}));

const api = vi.hoisted(() => ({
  ladeBetreuung: vi.fn(),
  legeStelleAn: vi.fn(),
  aendereStelle: vi.fn(),
  storniereStelle: vi.fn(),
  meldeBelegung: vi.fn(),
  nimmBelegungZurueck: vi.fn(),
  ladeBelegungKopfzahl: vi.fn(),
  ladeBelegungVerlauf: vi.fn(),
}));
vi.mock('../api/betreuung', () => api);

const stelle = (over: Partial<Betreuungsstelle> & { id: number }): Betreuungsstelle => ({
  einsatz_id: 1,
  bezeichnung: `Stelle ${over.id}`,
  art: 'notunterkunft',
  status: 'in_betrieb',
  angelegt_at: '2026-09-23 08:00:00',
  ...over,
});

const TURNHALLE = stelle({
  id: 8,
  bezeichnung: 'Turnhalle Ost',
  kapazitaet_personen: 150,
  standort: 'Am Sportplatz 3',
  leitung: 'Frau Schulz',
  erreichbarkeit: '0171 2345678',
  belegung: { id: 30, belegt: 89, zeitpunkt_at: '2026-09-23 10:00:00' },
});
const STADION = stelle({
  id: 9,
  bezeichnung: 'Weserstadion',
  art: 'anlaufstelle',
  kapazitaet_personen: 150,
  belegung: { id: 31, belegt: 140, zeitpunkt_at: '2026-09-23 10:00:00' },
});

const MIT_DATEN: BetreuungUebersicht = {
  stellen: [TURNHALLE, STADION],
  namentlich: [{ stelle_id: 8, anzahl: 1 }],
};

const BEWOHNER = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 7,
  status: 'betroffen',
  name: 'Muster',
  vorname: 'Max',
  erfasst_at: '2026-09-23 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-09-23 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  aktuelle_sichtung: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
  aktuelle_verbleib_art: 'notunterkunft',
  aktueller_verbleib: 'Notunterkunft',
  aktuelle_verbleib_betreuungsstelle_id: 8,
} as unknown as Person;

let personenAnfragen: URL[];

function renderPage(pfad = '/einsaetze/1/betreuung/8') {
  server.use(
    meHandler(benutzerFixture({ id: 1, anzeigename: 'Leitung' })),
    http.get('/api/einsaetze/1/personen', ({ request }) => {
      personenAnfragen.push(new URL(request.url));
      return HttpResponse.json([BEWOHNER]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/einsaetze/:id/betreuung/:stelleId', element: <BetreuungsstelleDetailPage /> },
      { path: '/einsaetze/:id/betreuung', element: <Sonde name="uebersicht" /> },
      { path: '/einsaetze/:id/lagekarte', element: <Sonde name="lagekarte" /> },
      { path: '/einsaetze/:id/verpflegung', element: <Sonde name="verpflegung" /> },
      { path: '/einsaetze/:id/personen/:pid', element: <Sonde name="person" /> },
      { path: '/einsaetze/:id/nachforderungen', element: <Sonde name="nachforderungen" /> },
    ],
    { initialEntries: [pfad] },
  );
  const ergebnis = render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          {/* Datenrouter: der Verlassen-Schutz braucht `useBlocker`. */}
          <RouterProvider router={router} />
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...ergebnis, client };
}

/** Ziel eines Sprungs: zeigt die angesteuerte Adresse. */
function Sonde({ name }: { name: string }) {
  const ort = useLocation();
  return <div data-testid={`ziel-${name}`}>{ort.pathname + ort.search}</div>;
}

/** Das geöffnete Menü — antd lässt die Portale geschlossener Dropdowns im Baum stehen. */
async function offenesMenue() {
  return waitFor(() => {
    const m = document.querySelector(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    ) as HTMLElement | null;
    expect(m).not.toBeNull();
    return m!;
  });
}

async function dialogMit(titel: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(titel, { selector: '.ant-modal-title' })).toBeInTheDocument();
  return dialog;
}

const kopf = () => screen.getByRole('heading', { level: 1 });

describe('BetreuungsstelleDetailPage (LLH-1044)', () => {
  beforeEach(() => {
    personenAnfragen = [];
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'einsatzleitung' };
    freigaben.wert = undefined;
    api.ladeBetreuung.mockResolvedValue(MIT_DATEN);
    api.ladeBelegungVerlauf.mockResolvedValue([]);
  });
  afterEach(async () => {
    vi.clearAllMocks();
    setzeOnline(true);
    await queueLeerenFuerTests();
  });

  it('Kopf: Bezeichnung, Art und Status; „Belegung melden“ als einzige Primäraktion, Status als Handlung', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: /Betreuungsstelle Turnhalle Ost/ }),
    ).toBeInTheDocument();
    expect(within(kopf()).getByText('Notunterkunft')).toBeInTheDocument();
    expect(within(kopf()).getByText('in Betrieb')).toBeInTheDocument();
    const primaer = document.querySelectorAll('.ant-btn-primary');
    expect(primaer).toHaveLength(1);
    expect(primaer[0]).toHaveAccessibleName('Belegung melden');
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Betreuung' })).toHaveAttribute(
      'href',
      '/einsaetze/1/betreuung',
    );
  });

  it('Belegung in Zahlen: Belegt, Kapazität, Frei, davon namentlich — Frei nie negativ', async () => {
    api.ladeBetreuung.mockResolvedValue({
      ...MIT_DATEN,
      stellen: [{ ...TURNHALLE, belegung: { id: 30, belegt: 170, zeitpunkt_at: 'x' } }, STADION],
    });
    renderPage();
    const band = await screen.findByRole('group', { name: 'Belegung in Zahlen' });
    expect(band).toHaveTextContent('Belegt170überbelegt');
    expect(band).toHaveTextContent('Kapazität150');
    expect(band).toHaveTextContent('Frei0');
    expect(band).toHaveTextContent('Davon namentlich1');
  });

  it('Stammdaten im Datenraster, Leitung und Erreichbarkeit sichtbar; Koordinate fehlt benannt', async () => {
    renderPage();
    await screen.findByText('Frau Schulz');
    const raster = document.querySelector<HTMLElement>('dl[aria-label="Stammdaten der Stelle"]')!;
    expect(raster).toHaveTextContent('Frau Schulz');
    expect(raster).toHaveTextContent('0171 2345678');
    expect(raster).toHaveTextContent('Am Sportplatz 3');
    expect(raster).toHaveTextContent('nicht verortet');
  });

  it('Bearbeiten in der Ansicht: PATCH nur mit den Änderungen, geleerte Leitung als null', async () => {
    api.aendereStelle.mockResolvedValue({ ...TURNHALLE, kapazitaet_personen: 200 });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const kapazitaet = await screen.findByLabelText('Kapazität (Personen)');
    expect(kapazitaet).toHaveValue('150');
    await userEvent.clear(kapazitaet);
    await userEvent.type(kapazitaet, '200');
    await userEvent.clear(screen.getByLabelText('Leitung'));
    // Kopf-Handlungen ruhen während der Sitzung; die Leiste trägt Speichern und Abbrechen.
    expect(screen.queryByRole('button', { name: 'Belegung melden' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.aendereStelle).toHaveBeenCalledWith(1, 8, {
        kapazitaet_personen: 200,
        leitung: null,
      }),
    );
    expect(
      await screen.findByText('Betreuungsstelle Turnhalle Ost gespeichert'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText('Kapazität (Personen)')).toBeNull());
  });

  it('Bearbeiten: Prüffehler stehen am Feld, nichts wird gesendet', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.clear(await screen.findByLabelText('Bezeichnung'));
    const leitung = screen.getByLabelText('Leitung');
    await userEvent.clear(leitung);
    await userEvent.click(leitung);
    await userEvent.paste('x'.repeat(201));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Bitte eine Bezeichnung angeben')).toBeInTheDocument();
    expect(
      await screen.findByText('Leitung darf höchstens 200 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(api.aendereStelle).not.toHaveBeenCalled();
  });

  it('Bearbeiten ohne Änderung oder mit Abbrechen sendet nichts; neu geöffnet stehen die Werte der Stelle', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.clear(await screen.findByLabelText('Leitung'));
    await userEvent.type(screen.getByLabelText('Leitung'), 'Herr Ott');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByLabelText('Leitung')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByLabelText('Leitung')).toHaveValue('Frau Schulz');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByLabelText('Leitung')).toBeNull());
    expect(api.aendereStelle).not.toHaveBeenCalled();
  });

  it('Schließen einer belegten Stelle: erst die Leermeldung an DIESE Stelle, dann der Status — ohne Rückweg auf die 0', async () => {
    api.meldeBelegung.mockResolvedValue({
      meldung_id: 92,
      stelle: { ...TURNHALLE, belegung: { id: 92, belegt: 0, zeitpunkt_at: 'x' } },
    });
    api.aendereStelle.mockResolvedValue({ ...TURNHALLE, status: 'geschlossen' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Schließen' }));
    const dialog = await dialogMit('Betreuungsstelle Turnhalle Ost schließen');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Belegung 0 melden/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stelle schließen' }));
    await waitFor(() =>
      expect(api.aendereStelle).toHaveBeenCalledWith(1, 8, { status: 'geschlossen' }),
    );
    expect(api.meldeBelegung).toHaveBeenCalledWith(1, 8, { belegt: 0 });
    expect(api.meldeBelegung.mock.invocationCallOrder[0]).toBeLessThan(
      api.aendereStelle.mock.invocationCallOrder[0],
    );
    expect(
      await screen.findByText('Betreuungsstelle Turnhalle Ost: geschlossen'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
  });

  it('eine leere Stelle schließt ohne Rückfrage; „In Betrieb nehmen“ und „Wieder öffnen“ ebenso', async () => {
    api.ladeBetreuung.mockResolvedValue({
      stellen: [{ ...TURNHALLE, belegung: { id: 30, belegt: 0, zeitpunkt_at: 'x' } }],
    });
    api.aendereStelle.mockResolvedValue({ ...TURNHALLE, status: 'geschlossen' });
    const { unmount } = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Schließen' }));
    await waitFor(() =>
      expect(api.aendereStelle).toHaveBeenCalledWith(1, 8, { status: 'geschlossen' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    api.ladeBetreuung.mockResolvedValue({ stellen: [{ ...TURNHALLE, status: 'vorbereitet' }] });
    const zweite = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'In Betrieb nehmen' }));
    await waitFor(() =>
      expect(api.aendereStelle).toHaveBeenLastCalledWith(1, 8, { status: 'in_betrieb' }),
    );
    zweite.unmount();

    api.ladeBetreuung.mockResolvedValue({
      stellen: [{ ...TURNHALLE, status: 'geschlossen', belegung: undefined }],
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Wieder öffnen' }));
    await waitFor(() =>
      expect(api.aendereStelle).toHaveBeenLastCalledWith(1, 8, { status: 'in_betrieb' }),
    );
  });

  it('an einer geschlossenen Stelle ist „Belegung melden“ gesperrt, der Grund steht daneben', async () => {
    api.ladeBetreuung.mockResolvedValue({
      stellen: [{ ...TURNHALLE, status: 'geschlossen', belegung: undefined }],
    });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Belegung melden' })).toBeDisabled();
    expect(screen.getByText('Stelle geschlossen')).toBeVisible();
  });

  it('Belegung melden: Dialog, Meldung an DIESE Stelle, Rückgängig im Toast', async () => {
    api.meldeBelegung.mockResolvedValue({ meldung_id: 91, stelle: TURNHALLE });
    api.nimmBelegungZurueck.mockResolvedValue({ meldung_id: 91, stelle: TURNHALLE });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Belegung melden' }));
    const dialog = await dialogMit('Belegung melden: Turnhalle Ost');
    await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '95');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
    await waitFor(() => expect(api.meldeBelegung).toHaveBeenCalledTimes(1));
    expect(api.meldeBelegung.mock.calls[0].slice(0, 2)).toEqual([1, 8]);
    expect(api.meldeBelegung.mock.calls[0][2]).toMatchObject({ belegt: 95 });
    await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
    await waitFor(() => expect(api.nimmBelegungZurueck).toHaveBeenCalledWith(1, 91));
  });

  it('Betroffene hier: Serverfilter auf die Stelle, Sprung in die Person', async () => {
    renderPage();
    expect(await screen.findByText('R-007')).toBeInTheDocument();
    expect(personenAnfragen).toHaveLength(1);
    expect(personenAnfragen[0].searchParams.get('betreuungsstelle_id')).toBe('8');
    await userEvent.click(screen.getByText('R-007'));
    expect(await screen.findByTestId('ziel-person')).toHaveTextContent('/einsaetze/1/personen/10');
  });

  it('ohne Personenrecht: kein Paneel, keine Abfrage, der Grund steht als Zeile', async () => {
    api.ladeBetreuung.mockResolvedValue({ stellen: [TURNHALLE, STADION] });
    renderPage();
    expect(await screen.findByText('Betroffene hier · Keine Berechtigung')).toBeInTheDocument();
    expect(screen.queryByText('Davon namentlich')).toBeNull();
    expect(personenAnfragen).toHaveLength(0);
  });

  it('Bedarf (LLH-1082): offene Nachforderungen der Stelle, „Bedarf anfordern“ führt in die Erfassung mit Bezug', async () => {
    freigaben.wert = freigabenFixture();
    server.use(
      http.get('/api/einsaetze/1/nachforderungen', () =>
        HttpResponse.json([
          {
            id: 21,
            einsatz_id: 1,
            art: 'Feldbetten',
            bezeichnung: 'Feldbetten für die Nacht',
            anzahl: 40,
            adressat_kategorie: 'leitstelle',
            prioritaet: 'normal',
            status: 'zugesagt',
            angefordert_at: '2026-09-23 09:00:00',
            erstellt_von_id: 1,
            erstellt_at: '2026-09-23 09:00:00',
            ist_offen: true,
            material_ids: [],
            betreuungsstelle_id: 8,
          },
          {
            id: 22,
            einsatz_id: 1,
            art: 'Decken',
            bezeichnung: 'Decken für das Weserstadion',
            adressat_kategorie: 'leitstelle',
            prioritaet: 'normal',
            status: 'angefordert',
            angefordert_at: '2026-09-23 09:00:00',
            erstellt_von_id: 1,
            erstellt_at: '2026-09-23 09:00:00',
            ist_offen: true,
            material_ids: [],
            betreuungsstelle_id: 9,
          },
        ]),
      ),
    );
    renderPage();
    const paneel = await screen.findByRole('region', { name: 'Bedarf' });
    expect(await within(paneel).findByRole('link', { name: '40× Feldbetten' })).toBeInTheDocument();
    expect(within(paneel).getByText('Zugesagt')).toBeInTheDocument();
    expect(within(paneel).queryByText(/Decken/)).toBeNull();
    await userEvent.click(within(paneel).getByRole('link', { name: /Bedarf anfordern/ }));
    expect(await screen.findByTestId('ziel-nachforderungen')).toHaveTextContent(
      '/einsaetze/1/nachforderungen?neu=1&betreuungsstelle=8&stelle=8',
    );
  });

  it('Bedarf ohne Freigabe Nachforderungen: der Grund steht als Zeile', async () => {
    freigaben.wert = freigabenFixture({ nachforderungen: { zugriff: false } });
    renderPage();
    expect(await screen.findByText('Bedarf · Keine Berechtigung')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bedarf' })).toBeNull();
  });

  it('Verpflegung: Anteil an „in Betreuung“ und Sprung ins Modul', async () => {
    renderPage();
    expect(await screen.findByText(/in Betreuung/)).toHaveTextContent(
      'Belegt 89 von 229 in Betreuung',
    );
    await userEvent.click(screen.getByRole('button', { name: /Zur Verpflegung/ }));
    expect(await screen.findByTestId('ziel-verpflegung')).toBeInTheDocument();
  });

  it('Menü: unverortet „Auf Karte verorten“ mit Rückweg, Stornieren mit Rückfrage führt auf die Übersicht', async () => {
    api.storniereStelle.mockResolvedValue({ ...TURNHALLE, storniert_at: 'x' });
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Weitere Aktionen zu Stelle Turnhalle Ost' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Stornieren/ }),
    );
    const dialog = await dialogMit('Betreuungsstelle Turnhalle Ost stornieren?');
    expect(
      within(dialog).getByRole('button', { name: 'Stattdessen schließen' }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stornieren' }));
    await waitFor(() => expect(api.storniereStelle).toHaveBeenCalledWith(1, 8));
    expect(await screen.findByTestId('ziel-uebersicht')).toHaveTextContent(
      /^\/einsaetze\/1\/betreuung$/,
    );
  });

  it('Menü: „Auf Karte verorten“ öffnet den Platziermodus mit Rückweg', async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Weitere Aktionen zu Stelle Turnhalle Ost' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: 'Auf Karte verorten' }),
    );
    expect(await screen.findByTestId('ziel-lagekarte')).toHaveTextContent(
      '/einsaetze/1/lagekarte?platzieren=betreuungsstelle%3A8&zurueck=1',
    );
  });

  it('verortet: Koordinate mit „Auf Karte zeigen“; gesperrte Lagekarte sperrt den Menüeintrag mit Grund', async () => {
    freigaben.wert = freigabenFixture({ lagekarte: { zugriff: false } });
    api.ladeBetreuung.mockResolvedValue({ stellen: [{ ...TURNHALLE, lat: 53.07, lon: 8.8 }] });
    const { client } = renderPage();
    await waitFor(() => expect(client.getQueryData(einsatzKeys.modulFreigaben(1))).toBeDefined());
    expect(await screen.findByText('53.07000, 8.80000')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Auf Karte zeigen' })).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Weitere Aktionen zu Stelle Turnhalle Ost' }),
    );
    expect(
      within(await offenesMenue()).getByRole('menuitem', {
        name: /Auf Karte zeigen \(Keine Berechtigung\)/,
      }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('Beobachter: keine Kopf-Handlungen und kein Bearbeiten, Hinweis mit Grund', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderPage();
    await screen.findByRole('group', { name: 'Belegung in Zahlen' });
    expect(screen.queryByRole('button', { name: 'Belegung melden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Schließen' })).toBeNull();
    expect(screen.getByText(/Nur Ansicht/)).toBeInTheDocument();
  });

  it('eine unbekannte oder stornierte Stelle führt auf die Übersicht; eine unlesbare ID ebenso', async () => {
    const { unmount } = renderPage('/einsaetze/1/betreuung/77');
    expect(await screen.findByTestId('ziel-uebersicht')).toHaveTextContent(
      /^\/einsaetze\/1\/betreuung$/,
    );
    unmount();
    renderPage('/einsaetze/1/betreuung/abc');
    expect(await screen.findByTestId('ziel-uebersicht')).toBeInTheDocument();
  });
});
