import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { appRouten } from '../App';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, setzeOnline } from '../test/utils';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';
import type {
  Betreuungsstelle,
  BetreuungUebersicht,
  GeraetAnzeige,
  Person,
  PersonDetail,
} from '../api/types';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { istHier } from './GeraetBetroffenePage';
import { freiePlaetze } from './GeraetBetreuungsstellePage';
import { geraetDarf } from './geraetSicht';

/**
 * Gerät einer Betreuungsstelle (LFH-1041, Spec `funktionsansichten`) im echten Routenbaum:
 * Betroffene der eigenen Stelle, Aufnahme ohne Sichtung, Belegung und Meldungen der Stelle.
 */

const geraet: GeraetAnzeige = {
  kopplung_id: 4,
  einsatz_id: 7,
  ansicht: 'betreuungsstelle',
  stelle_id: 3,
  uhs_id: null,
  stelle: 'NU Turnhalle Nord',
  bezeichnung: 'Tablet NU',
  laeuft_ab_at: '2026-10-08 23:00:00',
};

const stelle = {
  id: 3,
  einsatz_id: 7,
  bezeichnung: 'NU Turnhalle Nord',
  art: 'notunterkunft',
  kapazitaet_personen: 80,
  status: 'in_betrieb',
  angelegt_at: '2026-10-08 08:00:00',
  belegung: {
    id: 90,
    belegt: 40,
    zeitpunkt_at: '2026-10-08 09:00:00',
    erfasst_at: '2026-10-08 09:00:00',
  },
} as unknown as Betreuungsstelle;

function person(ueber: Partial<Person>): Person {
  return {
    id: 10,
    einsatz_id: 7,
    registrier_nr: 1,
    status: 'betroffen',
    name: 'Muster',
    vorname: 'Max',
    erfasst_at: '2026-10-08 09:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-10-08 09:00:00',
    geaendert_von: 1,
    storniert_at: null,
    aktuelle_sichtung: null,
    aktuelle_uhs_id: null,
    aktueller_platz_id: null,
    aktuelle_verbleib_art: 'notunterkunft',
    aktueller_verbleib: 'Notunterkunft',
    aktuelle_verbleib_betreuungsstelle_id: 3,
    ...ueber,
  } as Person;
}

const hier = person({ id: 10, registrier_nr: 1 });
const weiter = person({
  id: 11,
  registrier_nr: 2,
  name: 'Beispiel',
  aktuelle_verbleib_art: 'entlassung',
  aktueller_verbleib: 'entlassen',
  aktuelle_verbleib_betreuungsstelle_id: null,
});

let aufnahmeBody: Record<string, unknown> | null;

function bereit() {
  aufnahmeBody = null;
  server.use(
    meHandler({ ...benutzerFixture({ id: 51, anzeigename: 'NU Nord · Tablet NU' }), geraet }),
    http.get('/api/einsaetze/7', () =>
      HttpResponse.json(einsatzFixture({ id: 7, meine_rolle: 'fuehrungspersonal' })),
    ),
    http.get('/api/einsaetze/7/personen', () => HttpResponse.json([hier, weiter])),
    http.get('/api/einsaetze/7/betreuung', () =>
      HttpResponse.json({
        bezirke: [],
        stellen: [stelle],
        namentlich: [{ stelle_id: 3, anzahl: 2 }],
      } as BetreuungUebersicht),
    ),
    http.get('/api/einsaetze/7/betreuung/stellen/3/belegungen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/meldungen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/personen/10', () =>
      HttpResponse.json({
        ...hier,
        sichtungen: [],
        notizen: [],
        verbleib: [],
        abgleiche: [],
      } as PersonDetail),
    ),
    http.post('/api/einsaetze/7/personen', async ({ request }) => {
      aufnahmeBody = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(person({ id: 12, registrier_nr: 3 }), { status: 201 });
    }),
  );
}

function renderApp(route: string) {
  const router = createMemoryRouter(appRouten, { initialEntries: [route] });
  render(
    <QueryClientProvider client={neuerQueryClient()}>
      <ThemeModeProvider>
        <ConfigProvider>
          <AntApp>
            <RouterProvider router={router} />
          </AntApp>
        </ConfigProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
  return router;
}

const pfad = (router: ReturnType<typeof renderApp>) =>
  router.state.location.pathname + router.state.location.search;

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setzeOnline(true);
  localStorage.clear();
});

describe('Betreuungsstelle — Startseite und Navigation', () => {
  it('Start: die Betroffenen der Stelle mit „Aufnehmen“ als Primäraktion', async () => {
    bereit();
    const router = renderApp('/geraet');
    expect(await screen.findByRole('heading', { level: 1, name: 'Betroffene' })).toBeVisible();
    expect(pfad(router)).toBe('/geraet/7/betroffene');
    expect(screen.getByRole('button', { name: 'Aufnehmen' })).toBeVisible();
    expect(await screen.findByText('Muster, Max')).toBeVisible();
    expect(screen.getAllByText(/In der Stelle/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Weitergezogen/).length).toBeGreaterThan(0);
    const nav = screen.getByRole('navigation', { name: 'Gerätenavigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Betroffene', 'Aufnahme', 'Stelle']);
  });

  it('die Seiten der UHS führen auf die Startseite', async () => {
    bereit();
    const router = renderApp('/geraet/7/patienten');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/betroffene'));
  });
});

describe('Betreuungsstelle — Aufnahme und Person', () => {
  it('Aufnahme ohne Sichtung und ohne UHS; die Stelle bucht der Server', async () => {
    bereit();
    const router = renderApp('/geraet/7/betroffene/aufnahme?uhs=5');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/betroffene/aufnahme'));
    expect(await screen.findByRole('heading', { level: 1, name: /Aufnahme/ })).toBeVisible();
    expect(screen.queryByRole('radiogroup', { name: 'Sichtungskategorie' })).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Antreffort'), 'Sammelstelle{Enter}');
    await waitFor(() => expect(aufnahmeBody).not.toBeNull());
    expect(aufnahmeBody).not.toHaveProperty('uhs_id');
    expect(aufnahmeBody).not.toHaveProperty('sichtung');
    expect(await screen.findByText(/Erfasst als R-003 · untergebracht/)).toBeVisible();
  });

  it('Person: „Verbleib erfassen“ statt „Sichten“, kein Sichten im Menü', async () => {
    bereit();
    renderApp('/geraet/7/betroffene/10');
    expect(await screen.findByRole('heading', { level: 1, name: /Person R-001/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Verbleib erfassen' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sichten' })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Weitere Aktionen zu Person/ }));
    await waitFor(() =>
      expect(
        document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]'),
      ).not.toBeNull(),
    );
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    )!;
    expect(within(menue).getByText('Bearbeiten')).toBeInTheDocument();
    expect(within(menue).queryByText(/Sichten/)).toBeNull();
  });
});

describe('Betreuungsstelle — Bereich „Stelle“', () => {
  it('Belegung in Zahlen mit „davon namentlich“ und „Belegung melden“', async () => {
    bereit();
    renderApp('/geraet/7/betreuung');
    expect(await screen.findByRole('heading', { level: 1, name: 'Stelle' })).toBeVisible();
    const band = await screen.findByRole('group', { name: 'Belegung in Zahlen' });
    expect(within(band).getByText('Belegt').closest('div')?.parentElement).toHaveTextContent('40');
    expect(band).toHaveTextContent('Kapazität');
    expect(band).toHaveTextContent('Davon namentlich');
    expect(screen.getByRole('button', { name: 'Belegung melden' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Meldungen' })).toBeVisible();
  });
});

describe('Bausteine', () => {
  it('istHier: nur der jüngste Verbleib Notunterkunft an der eigenen Stelle', () => {
    expect(istHier(hier, 3)).toBe(true);
    expect(istHier(hier, 4)).toBe(false);
    expect(istHier(weiter, 3)).toBe(false);
    expect(istHier(hier, null)).toBe(false);
  });

  it('freiePlaetze: nur mit Kapazität und Meldung, nie negativ', () => {
    expect(freiePlaetze(stelle)).toBe(40);
    expect(freiePlaetze({ ...stelle, kapazitaet_personen: undefined })).toBeNull();
    expect(freiePlaetze({ ...stelle, belegung: undefined })).toBeNull();
    expect(freiePlaetze({ ...stelle, belegung: { ...stelle.belegung!, belegt: 95 } })).toBe(0);
  });

  it('geraetDarf: Sichtung an UHS-Geräten, nicht an der Betreuungsstelle', () => {
    expect(geraetDarf(geraet, 'person-sichtung')).toBe(false);
    expect(geraetDarf({ ...geraet, ansicht: 'uhs-tablet' }, 'person-sichtung')).toBe(true);
    expect(geraetDarf(null, 'person-sichtung')).toBe(true);
  });
});
