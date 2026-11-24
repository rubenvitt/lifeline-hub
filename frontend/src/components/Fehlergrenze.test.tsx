import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import { CLIENT_FEHLER_PFAD } from '../api/clientFehler';
import { einsatzKeys } from '../api/queryKeys';
import Fehlergrenze, { FEHLERGRENZE_TITEL, type FehlergrenzeRahmen } from './Fehlergrenze';

/**
 * Fehlergrenze je Rahmen (LLH-1822, Change `a12ms7g9-seitenzustaende` 2.1, Spec
 * `seiten-zustaende`): deutscher Text, genau zwei Knöpfe, nie Meldung oder Stack im DOM, der
 * zweite Ausweg je Rahmen, ein Bericht je Fehler. Ohne `AuthProvider`: keine Variante braucht
 * eine Sitzung, die Wurzel schon gar nicht.
 */

const GEHEIM = 'Cannot read properties of undefined (reading rolle) GEHEIMNIS-42';

/** Eine Seite, die beim Zeichnen wirft; der Stack trägt eine eigene Marke. */
function Kaputt(): never {
  const fehler = new TypeError(GEHEIM);
  fehler.stack = `TypeError: ${GEHEIM}\n    at Kaputt (STACKMARKE.tsx:1:1)`;
  throw fehler;
}

function Seite({ name }: { name: string }) {
  return <h1>{name}</h1>;
}

/** Eine Rahmenroute wie in `App.tsx`: Layout, pfadlose Kindroute mit Grenze, Seiten darunter. */
function rahmenRouten(rahmen: FehlergrenzeRahmen, basis: string, kinder: RouteObject[]) {
  return [
    {
      path: basis,
      element: (
        <div>
          <nav aria-label="Rahmen">Rahmen steht</nav>
          <Outlet />
        </div>
      ),
      children: [{ errorElement: <Fehlergrenze rahmen={rahmen} />, children: kinder }],
    },
    { path: '*', element: <Seite name="Anderswo" /> },
  ] satisfies RouteObject[];
}

let berichte = 0;

function renderRouten(
  routen: RouteObject[],
  start: string,
  { strict = false, client = neuerQueryClient() } = {},
) {
  berichte = 0;
  server.use(
    http.post(CLIENT_FEHLER_PFAD, () => {
      berichte += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const router = createMemoryRouter(routen, { initialEntries: [start] });
  const baum = (
    <QueryClientProvider client={client}>
      <ConfigProvider>
        <AntApp>
          <RouterProvider router={router} />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{baum}</StrictMode> : baum);
  return router;
}

const ursprung = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: ursprung });
  vi.restoreAllMocks();
});

/** Router-Fehler gehen bei React und react-router über `console.error`; das stört hier nur. */
function stillerKonsole() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}

function erwarteKeinenFehlertext() {
  const text = document.body.textContent ?? '';
  expect(text).not.toContain('GEHEIMNIS-42');
  expect(text).not.toContain('STACKMARKE');
  expect(text).not.toContain('TypeError');
  expect(text).not.toMatch(/Unexpected Application Error|Something went wrong|Error/);
}

const FAELLE: {
  rahmen: FehlergrenzeRahmen;
  ausweg: string;
  satz: string;
  basis: string;
  start: string;
  ziel: string;
}[] = [
  {
    rahmen: 'einsatz',
    ausweg: 'Zum Überblick',
    satz: 'Der Fehler wurde gemeldet. Die anderen Module arbeiten weiter.',
    basis: '/einsaetze/:id',
    start: '/einsaetze/7/etb',
    ziel: '/einsaetze/7/ueberblick',
  },
  {
    rahmen: 'ebene1',
    ausweg: 'Zur Einsatzliste',
    satz: 'Der Fehler wurde gemeldet.',
    basis: '/',
    start: '/profil',
    ziel: '/einsaetze',
  },
  {
    rahmen: 'verwaltung',
    ausweg: 'Zur Einsatzliste',
    satz: 'Der Fehler wurde gemeldet.',
    basis: '/admin',
    start: '/admin/benutzer',
    ziel: '/einsaetze',
  },
  {
    rahmen: 'geraet',
    ausweg: 'Zur Startseite',
    satz: 'Der Fehler wurde gemeldet.',
    basis: '/geraet',
    start: '/geraet/3/patienten',
    ziel: '/geraet',
  },
];

describe('Fehlergrenze je Rahmen', () => {
  for (const { rahmen, ausweg, satz, basis, start, ziel } of FAELLE) {
    it(`${rahmen}: deutscher Titel, genau „Neu laden“ und „${ausweg}“, kein Fehlertext, der Rahmen bleibt`, async () => {
      stillerKonsole();
      server.use(
        http.get('/api/incidents/:id/module-access', () => HttpResponse.json(freigabenFixture())),
      );
      const router = renderRouten(
        rahmenRouten(rahmen, basis, [{ path: '*', element: <Kaputt /> }]),
        start,
      );

      expect(await screen.findByText(FEHLERGRENZE_TITEL)).toBeInTheDocument();
      expect(screen.getByText(satz)).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Rahmen' })).toBeInTheDocument();
      const knoepfe = screen.getAllByRole('button');
      expect(knoepfe.map((k) => k.textContent)).toEqual(['Neu laden', ausweg]);
      expect(screen.getByRole('button', { name: 'Neu laden' })).toHaveClass('ant-btn-primary');
      erwarteKeinenFehlertext();

      await userEvent.click(screen.getByRole('button', { name: ausweg }));
      await waitFor(() => expect(router.state.location.pathname).toBe(ziel));
    });
  }

  it('außerhalb des Einsatzes fehlt der Satz über die anderen Module', async () => {
    stillerKonsole();
    renderRouten(rahmenRouten('ebene1', '/', [{ path: '*', element: <Kaputt /> }]), '/profil');
    await screen.findByText(FEHLERGRENZE_TITEL);
    expect(screen.queryByText(/anderen Module/)).not.toBeInTheDocument();
  });

  it('„Neu laden“ lädt die Seite neu', async () => {
    stillerKonsole();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...ursprung, reload },
    });
    renderRouten(rahmenRouten('ebene1', '/', [{ path: '*', element: <Kaputt /> }]), '/profil');
    await userEvent.click(await screen.findByRole('button', { name: 'Neu laden' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('Einsatz: ist der Überblick gesperrt, führt „Zum Überblick“ ins erste freie Modul', async () => {
    stillerKonsole();
    const gesperrt = freigabenFixture({ ueberblick: { zugriff: false } });
    server.use(http.get('/api/incidents/:id/module-access', () => HttpResponse.json(gesperrt)));
    // Die Freigaben hat der Rahmen längst geladen (derselbe Schlüssel wie in `EinsatzLayout`).
    const client = neuerQueryClient();
    client.setQueryData(einsatzKeys.modulFreigaben(7), gesperrt);
    const router = renderRouten(
      rahmenRouten('einsatz', '/einsaetze/:id', [{ path: '*', element: <Kaputt /> }]),
      '/einsaetze/7/lagekarte',
      { client },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Zum Überblick' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/einsaetze/7/etb'));
  });

  it('meldet den Fehler genau einmal, auch unter StrictMode, mit Routenmuster', async () => {
    stillerKonsole();
    renderRouten(
      rahmenRouten('einsatz', '/einsaetze/:id', [{ path: '*', element: <Kaputt /> }]),
      '/einsaetze/7/etb',
      { strict: true },
    );
    await screen.findByText(FEHLERGRENZE_TITEL);
    await waitFor(() => expect(berichte).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(berichte).toBe(1);
  });

  it('eine andere Adresse zeigt wieder ihre normale Seite', async () => {
    stillerKonsole();
    const router = renderRouten(
      rahmenRouten('ebene1', '/', [
        { path: 'kaputt', element: <Kaputt /> },
        { path: 'heil', element: <Seite name="Heile Seite" /> },
      ]),
      '/kaputt',
    );
    await screen.findByText(FEHLERGRENZE_TITEL);
    await router.navigate('/heil');
    expect(await screen.findByRole('heading', { name: 'Heile Seite' })).toBeInTheDocument();
    expect(screen.queryByText(FEHLERGRENZE_TITEL)).not.toBeInTheDocument();
  });
});

describe('Letztes Netz an der Wurzel', () => {
  /** Wie `App.tsx`: die oberste Route trägt die Grenze, ihr Element den `AuthProvider`. */
  function wurzelRouten(): RouteObject[] {
    return [
      {
        errorElement: <Fehlergrenze rahmen="wurzel" />,
        element: <Outlet />,
        children: [{ path: '*', element: <Kaputt /> }],
      },
    ];
  }

  it('zeichnet ohne AuthProvider eine ganze deutsche Seite mit „Neu laden“ und „Zur Einsatzliste“', async () => {
    stillerKonsole();
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...ursprung, assign },
    });
    renderRouten(wurzelRouten(), '/einsaetze/7/etb');

    expect(await screen.findByText(FEHLERGRENZE_TITEL)).toBeInTheDocument();
    expect(screen.getByText('Der Fehler wurde gemeldet.')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((k) => k.textContent)).toEqual([
      'Neu laden',
      'Zur Einsatzliste',
    ]);
    expect(screen.getByRole('main')).toContainElement(screen.getByText(FEHLERGRENZE_TITEL));
    erwarteKeinenFehlertext();

    await userEvent.click(screen.getByRole('button', { name: 'Zur Einsatzliste' }));
    expect(assign).toHaveBeenCalledWith('/einsaetze');
    await waitFor(() => expect(berichte).toBe(1));
  });
});
