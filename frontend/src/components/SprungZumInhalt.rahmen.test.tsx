import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { appRouten } from '../App';
import { neuerQueryClient } from '../test/utils';
import { meHandler, server } from '../test/server';
import { adminFixture } from '../test/fixtures';
import { setzeViewportBreite } from '../test/viewport';
import { defaultAdminPfad } from '../admin/adminNav';
import { SPRUNGZIEL_INHALT } from './SprungZumInhalt';

/**
 * Sprunglink in den Rahmen (nufmon70 1.2, Spec `einsatztauglichkeit-layout`, „Ein Sprunglink führt
 * zum Inhalt“): über die echte Routenquelle, damit `BetriebsLayout`, die Rahmen und ihre Ziele
 * zusammen geprüft werden. WÄCHTER: jeder Rahmen trägt ein Ziel, und der Link landet dort.
 * Geometrie und Sichtbarkeit misst `e2e/sprung-zum-inhalt.spec.ts`.
 */

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

afterEach(() => vi.restoreAllMocks());

function renderApp(route: string) {
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
  );
  const router = createMemoryRouter(appRouten, { initialEntries: [route] });
  render(
    <QueryClientProvider client={neuerQueryClient()}>
      <ConfigProvider>
        <AntApp>
          <RouterProvider router={router} />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return router;
}

const sprungLink = () => screen.getByRole('link', { name: 'Zum Inhalt springen' });
const ziele = () => [
  ...document.querySelectorAll<HTMLElement>(`[data-lfh="${SPRUNGZIEL_INHALT}"]`),
];
const letztesZiel = () => ziele()[ziele().length - 1];

/** Die Rahmen mit je einer Adresse und einem Anker, der erst mit dem Rahmen steht. */
const RAHMEN: { name: string; pfad: string; bereit: () => Promise<unknown> }[] = [
  {
    name: 'Ebene 1 (Einsatzliste)',
    pfad: '/einsaetze',
    bereit: () => screen.findByRole('button', { name: 'Neuer Einsatz' }),
  },
  {
    name: 'Einsatz (Überblick)',
    pfad: '/einsaetze/7/ueberblick',
    bereit: () => screen.findByRole('heading', { level: 1, name: /Überblick/ }),
  },
  {
    name: 'Verwaltung',
    pfad: defaultAdminPfad(),
    bereit: () => screen.findByRole('navigation', { name: 'Verwaltung' }),
  },
  {
    name: 'Hilfe',
    pfad: '/hilfe/anmelden-abmelden',
    bereit: () => screen.findByRole('heading', { level: 1, name: 'Hilfe' }),
  },
];

describe('Sprunglink zum Inhalt in den Rahmen', () => {
  for (const { name, pfad, bereit } of RAHMEN) {
    it(`${name}: erster Tab-Halt ist der Link, er führt auf das Ziel des Rahmens`, async () => {
      const router = renderApp(pfad);
      await bereit();
      const vorher = router.state.location;

      await userEvent.tab();
      expect(document.activeElement).toBe(sprungLink());
      // Genau ein Link je Seite: die Hilfe bindet ihn selbst ein, weil sie außerhalb von
      // `BetriebsLayout` liegt, nicht zusätzlich.
      expect(screen.getAllByRole('link', { name: 'Zum Inhalt springen' })).toHaveLength(1);

      // Wächter: der Rahmen trägt ein Ziel, und der Link landet auf dem letzten.
      expect(ziele().length, `${name}: kein Sprungziel`).toBeGreaterThan(0);
      await userEvent.keyboard('{Enter}');
      expect(document.activeElement).toBe(letztesZiel());
      expect(document.activeElement).toHaveAttribute('tabindex', '-1');
      // Die Adresse bleibt unverändert, auch ohne Hash.
      expect(router.state.location.pathname).toBe(vorher.pathname);
      expect(router.state.location.hash).toBe('');
    });
  }

  it('Einsatz: das Ziel ist das <main>, Kopf, Rail und Modulpanel liegen davor', async () => {
    renderApp('/einsaetze/7/ueberblick');
    await screen.findByRole('heading', { level: 1, name: /Überblick/ });
    const [ziel] = ziele();
    expect(ziele()).toHaveLength(1);
    expect(ziel.tagName).toBe('MAIN');
    const kopf = document.querySelector('[data-lfh="rahmen-kopf"]')!;
    expect(ziel.contains(kopf)).toBe(false);
    expect(kopf.compareDocumentPosition(ziel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ziel).toContainElement(screen.getByRole('heading', { level: 1, name: /Überblick/ }));
  });

  it.each([
    ['ab lg', 1280],
    ['unter lg', 390],
  ])(
    'Verwaltung %s: genau ein <main>, das Ziel ist der Inhalt neben dem Menü',
    async (_, breite) => {
      setzeViewportBreite(breite);
      renderApp(defaultAdminPfad());
      const menue = await screen.findByRole('navigation', { name: 'Verwaltung' });
      expect(document.querySelectorAll('main')).toHaveLength(1);
      const ziel = letztesZiel();
      expect(ziel.tagName).not.toBe('MAIN');
      expect(ziel.contains(menue)).toBe(false);
      expect(menue.compareDocumentPosition(ziel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(ziel).toContainElement(document.querySelector('[data-lfh="verwaltung-inhalt"]'));

      await userEvent.tab();
      await userEvent.keyboard('{Enter}');
      expect(document.activeElement).toBe(ziel);
      // Der nächste Tab bleibt im Inhalt, nicht im Menü.
      await userEvent.tab();
      expect(ziel).toContainElement(document.activeElement as HTMLElement);
      expect(menue).not.toContainElement(document.activeElement as HTMLElement);
    },
  );

  it('Störung der Verbindung: der Link steht vor der Betriebszeile', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp('/einsaetze');
    const zeile = await screen.findByText('Offline — keine Verbindung zum Server.');
    await act(async () => {});
    await userEvent.tab();
    expect(document.activeElement).toBe(sprungLink());
    expect(
      sprungLink().compareDocumentPosition(zeile) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('Einsatz, der nicht geladen werden kann: auch die Sackgasse ist das Ziel', async () => {
    // Statt des Rahmens steht dann nur die Sackgasse; ohne Ziel täte der Link nichts.
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ error: 'Serverfehler' }, { status: 500 }),
      ),
    );
    const router = createMemoryRouter(appRouten, { initialEntries: ['/einsaetze/7/ueberblick'] });
    render(
      <QueryClientProvider client={neuerQueryClient()}>
        <ConfigProvider>
          <AntApp>
            <RouterProvider router={router} />
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>,
    );
    const titel = await screen.findByText('Einsatz konnte nicht geladen werden');
    expect(ziele().length, 'kein Sprungziel').toBeGreaterThan(0);
    await userEvent.tab();
    expect(document.activeElement).toBe(sprungLink());
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(letztesZiel());
    expect(letztesZiel()).toContainElement(titel);
  });

  it('Hilfe: das Ziel ist ihr <main>', async () => {
    renderApp('/hilfe/anmelden-abmelden');
    await screen.findByRole('heading', { level: 1, name: 'Hilfe' });
    await waitFor(() => expect(sprungLink()).toBeInTheDocument());
    const main = document.querySelector('main')!;
    expect(ziele()).toEqual([main]);
  });
});
