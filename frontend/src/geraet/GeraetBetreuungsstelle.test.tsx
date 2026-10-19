import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { appRouten } from '../App';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, setzeOnline } from '../test/utils';
import { benutzerFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';
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
        transporte: [],
        massnahmen: [],
        verletzungen: [],
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

  it('die Liste bietet weder Sichtung noch Zeilenmenü (LLH-1130)', async () => {
    bereit();
    renderApp('/geraet/7/betroffene');
    expect(await screen.findByText('Muster, Max')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Sichtung R-|sichten$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu R-/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Verbleib erfassen für/ })).toBeNull();
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
    await user.type(screen.getByLabelText('Fundort'), 'Sammelstelle{Enter}');
    await waitFor(() => expect(aufnahmeBody).not.toBeNull());
    expect(aufnahmeBody).not.toHaveProperty('uhs_id');
    expect(aufnahmeBody).not.toHaveProperty('sichtung');
    expect(await screen.findByText(/Erfasst als R-003 · untergebracht/)).toBeVisible();
  });

  it('Person: „Verbleib erfassen“ im Kopf, die Sichtung nur lesend, kein Menü ohne Einträge', async () => {
    bereit();
    renderApp('/geraet/7/betroffene/10');
    expect(await screen.findByRole('heading', { level: 1, name: /Person R-001/ })).toBeVisible();
    // Sichten, Verbleib und Notiz stehen im Patientenkopf (LLH-1094); gesichtet wird an der
    // Betreuungsstelle nicht (LFH-1041), die Sichtung steht dort nur als Anzeige.
    const kopf = screen.getByRole('region', { name: 'Patientenkopf' });
    expect(within(kopf).getByRole('button', { name: 'Verbleib erfassen' })).toBeVisible();
    expect(within(kopf).getByText('ungesichtet')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Sichten/ })).toBeNull();
    // Kein Aufnehmen, Verlegen oder Austragen am Gerät (`person-zuordnungen`).
    expect(
      within(kopf).queryByRole('button', { name: /In UHS aufnehmen|Verlegen|Austragen/ }),
    ).toBeNull();
    // Keine Kopfaktion (LLH-1103): die Personendaten sind am Gerät feldweise schreibbar; Status
    // und Storno gibt es am Gerät nicht, also auch keinen Auslöser für ein leeres Menü.
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Name bearbeiten' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Weitere Aktionen zu Person/ })).toBeNull();
  });

  it('ohne Netz: die Pflicht-Stelle der Notunterkunft bleibt wählbar, auch wenn vorher kein Paneel offen war', async () => {
    bereit();
    let freigabeAbrufe = 0;
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () => {
        freigabeAbrufe += 1;
        return HttpResponse.json(freigabenFixture());
      }),
    );
    renderApp('/geraet/7/betroffene/10');
    const kopf = await screen.findByRole('region', { name: 'Patientenkopf' });
    // Die Personenseite lädt die Freigaben mit (Sprünge), die Kopfzeile hält die Stellen: beide
    // liegen im Speicher des Tabs, solange die Person geladen ist.
    await waitFor(() => expect(freigabeAbrufe).toBe(1));
    act(() => setzeOnline(false));
    const user = userEvent.setup();
    await user.click(within(kopf).getByRole('button', { name: 'Verbleib erfassen' }));
    const paneel = screen.getByRole('region', { name: 'Verbleib erfassen' });
    await user.click(within(paneel).getByRole('combobox', { name: 'Art' }));
    await user.click(await screen.findByTitle('Notunterkunft'));
    await user.click(await within(paneel).findByRole('combobox', { name: 'Betreuungsstelle' }));
    await user.click(await screen.findByTitle('NU Turnhalle Nord'));
    // Die Wahl belegt „Ziel“ mit dem Namen der Stelle vor.
    expect(within(paneel).getByRole('textbox', { name: 'Ziel' })).toHaveValue('NU Turnhalle Nord');
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
