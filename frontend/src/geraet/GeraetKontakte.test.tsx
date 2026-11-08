import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { appRouten } from '../App';
import { OFFLINE_QUEUE_BENUTZER_HEADER } from '../api/client';
import type { Einheit, GeraetAnzeige, Meldung, Person } from '../api/types';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, setzeOnline } from '../test/utils';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { meldeServerErreichbar, verbindungZuruecksetzenFuerTests } from '../offline/verbindung';
import { queueLeerenFuerTests } from '../offline/queue';
import { kontaktMarke } from './GeraetKontaktePage';

/**
 * Kontakt am Einheitengerät (LLH-1580, Konzept LLH-1571 S2): Schnellerfassung mit drei Ausgängen
 * und die Kontakte der Einheit ohne Namen. Den Zuschnitt (nur eigene, ohne Personalien, RTW als
 * Sofortmeldung) leistet der Server (`tests/geraet_kopplung.rs`); hier liefert er ihn fertig.
 */

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests.
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({ etikett }: { etikett: string }) => (
    <div role="group" aria-label={`Karte: ${etikett}`} />
  ),
}));

const GERAET = {
  kopplung_id: 4,
  einsatz_id: 7,
  ansicht: 'einheit',
  uhs_id: null,
  stelle_id: 5,
  stelle: 'Streife 2',
  bezeichnung: 'Handy',
  laeuft_ab_at: '2099-01-01 18:00:00',
} as GeraetAnzeige;

const EINHEIT = {
  id: 5,
  einsatz_id: 7,
  name: 'Streife 2',
  sortier: 1,
  sprechgruppen: [],
  fahrzeug_mitglieder: [],
  material_mitglieder: [],
  personal_mitglieder: [],
  ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 2 },
  status: { quelle: 'ohne', verteilung: [] },
  verbindungen: [],
} as unknown as Einheit;

function kontakt(id: number, p: Partial<Person> = {}): Person {
  return {
    id,
    einsatz_id: 7,
    registrier_nr: id,
    status: 'betroffen',
    erfasst_at: `2026-11-08 10:0${id}:00`,
    versorgende_einheit_id: 5,
    anlass: 'hitze_kaelte',
    ...p,
  } as unknown as Person;
}

interface Gesendet {
  body: Record<string, unknown>;
  ausQueue: boolean;
}

function stelleBereit({
  personen = [] as Person[],
  meldungen = [] as Meldung[],
  uhs = [{ id: 3, bezeichnung: 'UHS Bühne' }],
} = {}) {
  const gesendet: Gesendet[] = [];
  server.use(
    meHandler({ ...benutzerFixture({ id: 60, anzeigename: 'Streife 2 · Handy' }), geraet: GERAET }),
    http.get('/api/einsaetze/7', () =>
      HttpResponse.json(einsatzFixture({ id: 7, meine_rolle: 'fuehrungspersonal' })),
    ),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([EINHEIT])),
    http.get('/api/einsaetze/7/auftraege', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/meldungen', () => HttpResponse.json(meldungen)),
    http.get('/api/einsaetze/7/personen', () => HttpResponse.json(personen)),
    http.get('/api/einsaetze/7/personen/uhs', () => HttpResponse.json(uhs)),
    http.post('/api/einsaetze/7/personen', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      gesendet.push({ body, ausQueue: request.headers.has(OFFLINE_QUEUE_BENUTZER_HEADER) });
      return HttpResponse.json(kontakt(12, { registrier_nr: 12 }), { status: 201 });
    }),
  );
  return { gesendet };
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

async function oeffneKontakt() {
  const user = userEvent.setup();
  const knopf = await screen.findByRole('button', { name: 'Kontakt' });
  await waitFor(() => expect(knopf).toBeEnabled());
  await user.click(knopf);
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('radio', { name: 'Hitze / Kälte' }));
  return { user, dialog };
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  sessionStorage.clear();
});
afterEach(async () => {
  setzeOnline(true);
  vi.unstubAllGlobals();
  await queueLeerenFuerTests();
  FakeEventSource.zuruecksetzen();
  verbindungZuruecksetzenFuerTests();
  localStorage.clear();
});

describe('Einheitengerät — Kontakte', () => {
  it('listet die Kontakte der Einheit ohne Namen, neueste oben, mit Ausgang', async () => {
    stelleBereit({
      personen: [
        kontakt(1, { aktuelle_verbleib_art: 'entlassung' }),
        kontakt(2, { aktuelle_uhs_id: 3 }),
      ],
    });
    renderApp('/geraet/7/kontakte');
    const liste = await screen.findByText('R-002');
    const zeilen = within(liste.closest('[data-lfh="kontakt-liste"]') as HTMLElement).getAllByText(
      /^R-/,
    );
    expect(zeilen.map((z) => z.textContent)).toEqual(['R-002', 'R-001']);
    expect(screen.getByText('entlassen')).toBeVisible();
    expect(await screen.findByText('UHS Bühne')).toBeVisible();
  });

  it('Entlassen: ein Griff nach dem Anlass, fest die eigene Einheit', async () => {
    const { gesendet } = stelleBereit();
    renderApp('/geraet/7/kontakte');
    const { user, dialog } = await oeffneKontakt();
    expect(within(dialog).queryByRole('textbox', { name: 'Name' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Entlassen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    // Der Fundort steht vor auf der Einheit; Namen und Alter gibt es nicht (K5).
    expect(gesendet[0].body).toEqual({
      status: 'betroffen',
      versorgende_einheit_id: 5,
      entlassen: true,
      anlass: 'hitze_kaelte',
      antreff_ort: 'Streife 2',
      client_id: expect.any(String),
    });
  });

  it('Zur UHS bucht in die UHS', async () => {
    const { gesendet } = stelleBereit();
    renderApp('/geraet/7/kontakte');
    const { user, dialog } = await oeffneKontakt();
    await user.click(within(dialog).getByRole('button', { name: 'Zur UHS' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0].body).toMatchObject({ uhs_id: 3, versorgende_einheit_id: 5 });
    expect(gesendet[0].body).not.toHaveProperty('entlassen');
  });

  it('ohne aktive UHS gibt es „Zur UHS“ nicht', async () => {
    stelleBereit({ uhs: [] });
    renderApp('/geraet/7/kontakte');
    const { dialog } = await oeffneKontakt();
    expect(within(dialog).queryByRole('button', { name: 'Zur UHS' })).toBeNull();
  });

  it('RTW nötig geht direkt, nie über die Warteschlange (K2)', async () => {
    const { gesendet } = stelleBereit();
    renderApp('/geraet/7/kontakte');
    const { user, dialog } = await oeffneKontakt();
    await user.click(within(dialog).getByRole('button', { name: 'RTW nötig' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0].body).toMatchObject({
      rtw: true,
      versorgende_einheit_id: 5,
      client_id: expect.any(String),
    });
    expect(gesendet[0].ausQueue).toBe(false);
    expect(await screen.findByText('R-012 · RTW angefordert')).toBeInTheDocument();
  });

  it('ein erneuter RTW nach verlorener Antwort trägt dieselbe client_id', async () => {
    const { gesendet } = stelleBereit();
    let ersterVersuch = true;
    server.use(
      http.post('/api/einsaetze/7/personen', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        gesendet.push({ body, ausQueue: request.headers.has(OFFLINE_QUEUE_BENUTZER_HEADER) });
        if (ersterVersuch) {
          ersterVersuch = false;
          return HttpResponse.error();
        }
        return HttpResponse.json(kontakt(12, { registrier_nr: 12 }), { status: 201 });
      }),
    );
    renderApp('/geraet/7/kontakte');
    const { user, dialog } = await oeffneKontakt();
    await user.click(within(dialog).getByRole('button', { name: 'RTW nötig' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    // Der Fehler meldet den Server unerreichbar: bis die Verbindung steht, heißt es „über Funk“.
    expect(await within(dialog).findByRole('button', { name: 'RTW über Funk' })).toBeDisabled();
    act(() => meldeServerErreichbar(true));
    await user.click(await within(dialog).findByRole('button', { name: 'RTW nötig' }));
    await waitFor(() => expect(gesendet).toHaveLength(2));
    expect(gesendet[0].body.client_id).toEqual(expect.any(String));
    expect(gesendet[1].body.client_id).toBe(gesendet[0].body.client_id);
    expect(await screen.findByText('R-012 · RTW angefordert')).toBeInTheDocument();
  });

  it('ohne Verbindung: RTW über Funk und gesperrt, Entlassen merkt vor', async () => {
    const { gesendet } = stelleBereit();
    renderApp('/geraet/7/kontakte');
    const { user, dialog } = await oeffneKontakt();
    act(() => setzeOnline(false));
    const funk = await within(dialog).findByRole('button', { name: 'RTW über Funk' });
    expect(funk).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'RTW nötig' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Entlassen' }));
    expect(await screen.findByText('Offline vorgemerkt · R-…')).toBeInTheDocument();
    expect(gesendet).toEqual([]);
  });
});

describe('kontaktMarke', () => {
  const offen = {
    aktuelle_verbleib_art: null,
    aktuelle_uhs_id: null,
    meldung_id: null,
    versorgung: null,
  } as unknown as Parameters<typeof kontaktMarke>[0];
  const meldung = (p: Partial<Meldung>) =>
    ({ ist_bestaetigt: false, ist_ueberfaellig: false, eskaliert: false, ...p }) as Meldung;

  it('zeigt den Ausgang: entlassen, UHS, sonst offen', () => {
    expect(
      kontaktMarke(
        { ...offen, aktuelle_verbleib_art: 'entlassung' },
        undefined,
        undefined,
        undefined,
      ),
    ).toEqual({ ton: 'neutral', wort: 'entlassen' });
    expect(
      kontaktMarke({ ...offen, aktuelle_uhs_id: 3 }, undefined, 'UHS Bühne', undefined),
    ).toEqual({ ton: 'bedien', wort: 'UHS Bühne' });
    expect(kontaktMarke(offen, undefined, undefined, undefined)).toEqual({
      ton: 'achtung',
      wort: 'offen',
    });
  });

  it('zeigt den Stand der RTW-Meldung (K8): offen mit Frist, bestätigt, überfällig über Funk', () => {
    const mitRtw = { ...offen, meldung_id: 41 };
    expect(kontaktMarke(mitRtw, meldung({}), undefined, '10:05')).toEqual({
      ton: 'achtung',
      wort: 'RTW offen bis 10:05',
    });
    expect(kontaktMarke(mitRtw, meldung({ ist_bestaetigt: true }), undefined, '10:05')).toEqual({
      ton: 'normal',
      wort: 'RTW bestätigt',
    });
    expect(kontaktMarke(mitRtw, meldung({ ist_ueberfaellig: true }), undefined, '10:05')).toEqual({
      ton: 'alarm',
      wort: 'RTW · Funk',
    });
  });
});
