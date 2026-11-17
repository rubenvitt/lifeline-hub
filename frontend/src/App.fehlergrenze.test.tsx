import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { appRouten } from './App';
import { neuerQueryClient } from './test/utils';
import { meHandler, server } from './test/server';
import { adminFixture } from './test/fixtures';
import { setzeViewportBreite } from './test/viewport';
import { merkeRouten } from './rueckmeldung/adresse';
import { CLIENT_FEHLER_PFAD } from './api/clientFehler';
import { FEHLERGRENZE_TITEL } from './components/Fehlergrenze';

/**
 * Fehlergrenze je Rahmen über die echte Routenquelle (LLH-1822, Change `a12ms7g9-seitenzustaende`
 * 2.2, Spec `seiten-zustaende`): Eine Seite wirft beim Zeichnen, der Rahmen bleibt bedienbar, ein
 * Wechsel zeigt wieder die normale Seite, genau ein Bericht geht an den Server. Wirft der Rahmen
 * selbst, fängt ihn das letzte Netz an der Wurzel, deutsch, nie die Standardseite des Routers.
 */

const wirft = vi.hoisted(() => ({ etb: true, profil: true, benutzer: true, einsatzRahmen: false }));

function wurf(was: string): never {
  throw new TypeError(`Cannot read properties of undefined (reading 'rolle') ${was}-GEHEIM`);
}

vi.mock('./pages/EtbPage', () => ({
  default: function EtbProbe() {
    if (wirft.etb) wurf('etb');
    return <h1>ETB-Probe</h1>;
  },
}));
vi.mock('./pages/PersonenPage', () => ({
  default: () => <h1>Personen-Probe</h1>,
}));
vi.mock('./pages/ProfilPage', () => ({
  default: function ProfilProbe() {
    if (wirft.profil) wurf('profil');
    return <h1>Profil-Probe</h1>;
  },
}));
vi.mock('./pages/BenutzerPage', () => ({
  default: function BenutzerProbe() {
    if (wirft.benutzer) wurf('benutzer');
    return <h1>Benutzer-Probe</h1>;
  },
}));
vi.mock('./einsatz/EinsatzLayout', async (importOriginal) => {
  const echt = await importOriginal<typeof import('./einsatz/EinsatzLayout')>();
  const Echt = echt.default;
  return {
    ...echt,
    default: function EinsatzLayoutProbe() {
      if (wirft.einsatzRahmen) wurf('rahmen');
      return <Echt />;
    },
  };
});

const admin = adminFixture();
const einsatz = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  stichwort: null,
  status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
};

let berichte: { route: string; meldung: string }[] = [];

beforeAll(() => merkeRouten(appRouten));
afterAll(() => merkeRouten([]));

afterEach(() => {
  Object.assign(wirft, { etb: true, profil: true, benutzer: true, einsatzRahmen: false });
  vi.restoreAllMocks();
});

function renderApp(route: string) {
  // React und der Router melden den gefangenen Wurf über die Konsole; das ist hier gewollt.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Je Test eine eigene Liste: ein Bericht des vorigen Tests, der noch unterwegs ist, landet nicht hier.
  const liste: { route: string; meldung: string }[] = [];
  berichte = liste;
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.post(CLIENT_FEHLER_PFAD, async ({ request }) => {
      liste.push((await request.json()) as { route: string; meldung: string });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const router = createMemoryRouter(appRouten, { initialEntries: [route] });
  render(
    <StrictMode>
      <QueryClientProvider client={neuerQueryClient()}>
        <ConfigProvider>
          <AntApp>
            <RouterProvider router={router} />
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  return router;
}

/** Nie die Meldung des Wurfs, nie ein Stack, nie die englische Standardseite des Routers. */
function erwarteKeinenFehlertext() {
  const text = document.body.textContent ?? '';
  expect(text).not.toContain('GEHEIM');
  expect(text).not.toContain('TypeError');
  expect(text).not.toContain('Unexpected Application Error');
}

/** Der Inhalt neben dem Rahmen: das Ziel des Sprunglinks. */
const inhalt = () => {
  const ziele = document.querySelectorAll<HTMLElement>('[data-lfh="sprungziel-inhalt"]');
  return ziele[ziele.length - 1];
};

describe('Fehlergrenze im Einsatzrahmen', () => {
  it('ein Modul stürzt ab: Kopf und Rail bleiben bedienbar, ein Wechsel zeigt das andere Modul', async () => {
    setzeViewportBreite(1440);
    const router = renderApp('/einsaetze/7/etb');

    expect(await screen.findByText(FEHLERGRENZE_TITEL)).toBeInTheDocument();
    const grenze = within(inhalt());
    expect(
      grenze.getByText('Der Fehler wurde gemeldet. Die anderen Module arbeiten weiter.'),
    ).toBeInTheDocument();
    expect(grenze.getAllByRole('button').map((k) => k.textContent)).toEqual([
      'Neu laden',
      'Zum Überblick',
    ]);
    erwarteKeinenFehlertext();

    // Der Rahmen steht: Kopf mit Einsatzname, Rail mit ihren Kategorien.
    expect(document.querySelector('[data-lfh="rahmen-kopf"]')).not.toBeNull();
    expect(await screen.findByRole('button', { name: /Hochwasser Nord/ })).toBeEnabled();
    const rail = screen.getByRole('navigation', { name: 'Kategorien' });

    // Genau ein Bericht, mit Routenmuster statt Kennung, auch unter StrictMode.
    await waitFor(() => expect(berichte).toHaveLength(1));
    expect(berichte[0].route).toBe('/einsaetze/:id/etb');

    await userEvent.click(await within(rail).findByRole('link', { name: 'Betroffene & Schäden' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/einsaetze/7/personen'));
    expect(await screen.findByRole('heading', { name: 'Personen-Probe' })).toBeInTheDocument();
    expect(screen.queryByText(FEHLERGRENZE_TITEL)).not.toBeInTheDocument();

    // Zurück auf das kaputte Modul, jetzt heil: die normale Seite, kein weiterer Bericht.
    wirft.etb = false;
    await act(async () => {
      await router.navigate('/einsaetze/7/etb');
    });
    expect(await screen.findByRole('heading', { name: 'ETB-Probe' })).toBeInTheDocument();
    expect(berichte).toHaveLength(1);
  });

  it('„Zum Überblick“ führt in den Überblick des Einsatzes', async () => {
    const router = renderApp('/einsaetze/7/etb');
    await userEvent.click(await screen.findByRole('button', { name: 'Zum Überblick' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/einsaetze/7/ueberblick'));
  });
});

describe('Fehlergrenze in Ebene 1 und Verwaltung', () => {
  it('Ebene 1: der Rahmen bleibt, der zweite Ausweg heißt „Zur Einsatzliste“', async () => {
    const router = renderApp('/profil');
    expect(await screen.findByText(FEHLERGRENZE_TITEL)).toBeInTheDocument();
    expect(screen.getByText('Der Fehler wurde gemeldet.')).toBeInTheDocument();
    erwarteKeinenFehlertext();
    expect(
      within(inhalt())
        .getAllByRole('button')
        .map((k) => k.textContent),
    ).toEqual(['Neu laden', 'Zur Einsatzliste']);
    await waitFor(() => expect(berichte).toHaveLength(1));
    expect(berichte[0].route).toBe('/profil');

    await userEvent.click(screen.getByRole('button', { name: 'Zur Einsatzliste' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/einsaetze'));
    expect(await screen.findByRole('button', { name: 'Neuer Einsatz' })).toBeInTheDocument();
  });

  it('Verwaltung: das Menü bleibt bedienbar, der zweite Ausweg heißt „Zur Einsatzliste“', async () => {
    setzeViewportBreite(1440);
    const router = renderApp('/admin/benutzer');
    expect(await screen.findByText(FEHLERGRENZE_TITEL)).toBeInTheDocument();
    erwarteKeinenFehlertext();
    const menue = screen.getByRole('navigation', { name: 'Verwaltung' });
    // Die Grenze steht im Inhalt neben dem Menü, nicht an seiner Stelle.
    expect(menue).not.toContainElement(screen.getByText(FEHLERGRENZE_TITEL));
    // Der Inhalt bleibt unsichtbar, bis der Befund des Server-Rechners da ist (`AdminLayout`).
    await waitFor(() =>
      expect(
        within(inhalt())
          .getAllByRole('button')
          .map((k) => k.textContent),
      ).toEqual(['Neu laden', 'Zur Einsatzliste']),
    );
    await waitFor(() => expect(berichte).toHaveLength(1));

    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Einsatz-Stichworte' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/admin/stammdaten/stichworte'),
    );
    await waitFor(() => expect(screen.queryByText(FEHLERGRENZE_TITEL)).not.toBeInTheDocument());
    expect(berichte).toHaveLength(1);
  });
});

describe('Letztes Netz an der Wurzel', () => {
  it('wirft der Einsatzrahmen selbst, steht eine deutsche Seite mit „Neu laden“ und „Zur Einsatzliste“', async () => {
    wirft.einsatzRahmen = true;
    renderApp('/einsaetze/7/etb');
    expect(await screen.findByText(FEHLERGRENZE_TITEL)).toBeInTheDocument();
    expect(screen.getByText('Der Fehler wurde gemeldet.')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((k) => k.textContent)).toEqual([
      'Neu laden',
      'Zur Einsatzliste',
    ]);
    // Kein Rahmen mehr: weder Kopf noch Rail.
    expect(document.querySelector('[data-lfh="rahmen-kopf"]')).toBeNull();
    erwarteKeinenFehlertext();
    await waitFor(() => expect(berichte).toHaveLength(1));
  });
});
