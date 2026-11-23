import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { adapterFixture, adapterListeFixture } from '../../test/adapterDaten';
import type { AdapterAnzeige, AdapterListe } from '../../api/types';
import { globalKeys } from '../../api/queryKeys';
import AdapterAnsicht from './AdapterAnsicht';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

import { useAuth } from '../../auth/AuthContext';
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

/** Ansicht eines Adapters (LLH-2018). */

const GEHEIM = 'neuer-geheimer-wert-77';

interface Aufruf {
  methode: string;
  pfad: string;
  body: unknown;
}

function stelleBereit(start: AdapterAnzeige, extra: Partial<AdapterListe> = {}) {
  const aufrufe: Aufruf[] = [];
  let stand = start;
  const liste = () => adapterListeFixture({ adapter: [stand], ...extra });
  const merke = async (methode: string, request: Request, pfad: string) => {
    const text = await request.text();
    aufrufe.push({ methode, pfad, body: text ? JSON.parse(text) : null });
  };
  server.use(
    http.get('/api/admin/adapter', () => HttpResponse.json(liste())),
    http.get('/api/admin/adapter/a1/attempts', () =>
      HttpResponse.json([
        {
          at: '2026-11-22 08:51:12',
          probe: false,
          erfolg: false,
          fehler_art: 'zeitueberschreitung',
          dauer_ms: 20000,
        },
        {
          at: '2026-11-22 08:50:02',
          probe: true,
          erfolg: true,
          dauer_ms: 412,
          anzahl: 4,
        },
      ]),
    ),
    http.patch('/api/admin/adapter/a1', async ({ request }) => {
      await merke('PATCH', request, 'a1');
      const body = aufrufe[aufrufe.length - 1].body as Record<string, unknown>;
      stand = {
        ...stand,
        ...(body.name ? { name: String(body.name) } : {}),
        ...(body.einstellungen ? { einstellungen: body.einstellungen as never } : {}),
        ...(body.lan_erlaubt !== undefined ? { lan_erlaubt: Boolean(body.lan_erlaubt) } : {}),
        geaendert_at: '2026-11-22 09:00:00',
      };
      return HttpResponse.json(stand);
    }),
    http.put('/api/admin/adapter/a1/secrets/:platz', async ({ request, params }) => {
      await merke('PUT', request, `geheimnis/${String(params.platz)}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/admin/adapter/a1/secrets/:platz', async ({ request, params }) => {
      await merke('DELETE', request, `geheimnis/${String(params.platz)}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/admin/adapter/a1/check', async ({ request }) => {
      await merke('POST', request, 'pruefen');
      return HttpResponse.json({ erfolg: true, dauer_ms: 412, anzahl: 4 });
    }),
    http.post('/api/admin/adapter/a1/pause', async ({ request }) => {
      await merke('POST', request, 'anhalten');
      stand = { ...stand, zustand: 'aus', angehalten_at: '2026-11-22 09:00:00' };
      return HttpResponse.json(stand);
    }),
    http.post('/api/admin/adapter/a1/resume', async ({ request }) => {
      await merke('POST', request, 'fortsetzen');
      stand = { ...stand, zustand: 'ok', angehalten_at: undefined };
      return HttpResponse.json(stand);
    }),
    http.delete('/api/admin/adapter/a1', async ({ request }) => {
      await merke('DELETE', request, 'a1');
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return aufrufe;
}

function rendere(id = 'a1') {
  return renderMitProviders(
    <Routes>
      <Route path="/admin/einstellungen/anbindungen" element={<p>Liste der Anbindungen</p>} />
      <Route
        path="/admin/einstellungen/anbindungen/adapter/:adapterId"
        element={<AdapterAnsicht />}
      />
    </Routes>,
    { route: `/admin/einstellungen/anbindungen/adapter/${id}`, datenRouter: true },
  );
}

const paneel = (titel: string) =>
  screen.getByRole('heading', { name: titel }).closest<HTMLElement>('section')!;

describe('AdapterAnsicht', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });

  it('zeigt Kopf, Zustand und Verlauf eines gestörten Adapters', async () => {
    stelleBereit(
      adapterFixture('a1', {
        name: 'Alarmquelle Leitstelle',
        zustand: 'gestoert',
        fehler_seit: '2026-11-22 08:42:00',
        fehlversuche: 3,
        letzter_fehler: { at: '2026-11-22 08:51:00', art: 'zeitueberschreitung' },
      }),
    );
    rendere();
    expect(
      await screen.findByRole('heading', { name: /Alarmquelle Leitstelle/ }),
    ).toBeInTheDocument();
    const zustand = paneel('Zustand');
    expect(zustand).toHaveTextContent('gestört');
    expect(zustand).toHaveTextContent('3 Fehlversuche');
    expect(zustand).toHaveTextContent('Keine Antwort in 20 s');
    expect(zustand).toHaveTextContent('4 Einträge');
    const verlauf = paneel('Letzte Versuche');
    expect(
      await within(verlauf).findByText('erreichbar · 4 Einträge · Prüfung'),
    ).toBeInTheDocument();
    expect(within(verlauf).getByText('Keine Antwort in 20 s')).toBeInTheDocument();
  });

  it('prüft die Verbindung und zeigt das Ergebnis, ohne den Zustand zu ändern', async () => {
    const aufrufe = stelleBereit(adapterFixture('a1'));
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Verbindung prüfen' }));
    await screen.findByText(/Verbindung prüfen: erreichbar · 4 Einträge/);
    expect(document.querySelector('[data-lfh="adapter-pruefung"]')).toHaveTextContent(
      '412 ms · nichts übernommen',
    );
    expect(aufrufe.map((a) => a.pfad)).toEqual(['pruefen']);
  });

  it('hält an und setzt fort', async () => {
    const aufrufe = stelleBereit(adapterFixture('a1'));
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Anhalten' }));
    expect(await screen.findByRole('button', { name: 'Fortsetzen' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fortsetzen' }));
    expect(await screen.findByRole('button', { name: 'Anhalten' })).toBeInTheDocument();
    expect(aufrufe.map((a) => a.pfad)).toEqual(['anhalten', 'fortsetzen']);
  });

  it('ändert Name und Einstellungen mit Basis', async () => {
    const aufrufe = stelleBereit(adapterFixture('a1'));
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Einstellungen bearbeiten' }));
    const standort = screen.getByRole('textbox', { name: 'Standort-Kennung' });
    await user.clear(standort);
    await user.type(standort, 'WA-02');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        {
          methode: 'PATCH',
          pfad: 'a1',
          body: {
            einstellungen: { url: 'https://alarm.example/api', standort: 'WA-02' },
            basis_geaendert_at: '2026-11-21 17:04:00',
          },
        },
      ]),
    );
  });

  it('fragt vor einem neuen Ziel und sendet ohne Bestätigung nichts', async () => {
    const aufrufe = stelleBereit(adapterFixture('a1'));
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Einstellungen bearbeiten' }));
    const url = screen.getByRole('textbox', { name: 'Adresse' });
    await user.clear(url);
    await user.type(url, 'https://alarm2.example/api');
    // In jsdom endet die Ausblend-Animation des Dialogs nie: den Knopf vorher greifen
    // (`test/rueckfrage.ts`).
    const speichern = screen.getByRole('button', { name: 'Speichern' });
    await user.click(speichern);
    const frage = await screen.findByRole('dialog', {
      name: 'Neues Ziel: Geheimnisse werden entfernt',
    });
    expect(frage).toHaveTextContent('alarm.example → alarm2.example');
    expect(frage).toHaveTextContent('API-Schlüssel');
    await user.click(within(frage).getByRole('button', { name: 'Abbrechen' }));
    expect(
      await screen.findByText(/Nicht gespeichert: das neue Ziel ist nicht bestätigt/),
    ).toBeInTheDocument();
    expect(aufrufe).toEqual([]);

    await user.click(speichern);
    await user.click(within(frage).getByRole('button', { name: 'Speichern und entfernen' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        {
          methode: 'PATCH',
          pfad: 'a1',
          body: {
            einstellungen: { url: 'https://alarm2.example/api', standort: 'WA-01' },
            basis_geaendert_at: '2026-11-21 17:04:00',
          },
        },
      ]),
    );
  });

  it('fragt nach dem Stand des Servers, nicht nach einem veralteten Cache', async () => {
    const ohneGeheimnis = adapterFixture('a1', {
      geheimnisse: adapterFixture('a1').geheimnisse.map((g) => ({ ...g, is_gesetzt: false })),
    });
    const aufrufe = stelleBereit(ohneGeheimnis);
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Einstellungen bearbeiten' }));
    // Inzwischen setzt jemand ein Geheimnis; die Seite hat es noch nicht neu geladen.
    server.use(
      http.get('/api/admin/adapter', () =>
        HttpResponse.json(adapterListeFixture({ adapter: [adapterFixture('a1')] })),
      ),
    );
    const url = screen.getByRole('textbox', { name: 'Adresse' });
    await user.clear(url);
    await user.type(url, 'https://alarm2.example/api');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(
      await screen.findByRole('dialog', { name: 'Neues Ziel: Geheimnisse werden entfernt' }),
    ).toBeInTheDocument();
    expect(aufrufe).toEqual([]);
  });

  it('fragt ohne gesetztes Geheimnis nicht nach dem neuen Ziel', async () => {
    const ohneGeheimnis = adapterFixture('a1', {
      geheimnisse: adapterFixture('a1').geheimnisse.map((g) => ({ ...g, is_gesetzt: false })),
    });
    const aufrufe = stelleBereit(ohneGeheimnis);
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Einstellungen bearbeiten' }));
    const url = screen.getByRole('textbox', { name: 'Adresse' });
    await user.clear(url);
    await user.type(url, 'https://alarm2.example/api');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(aufrufe.map((a) => a.methode)).toEqual(['PATCH']));
    expect(
      screen.queryByRole('dialog', { name: 'Neues Ziel: Geheimnisse werden entfernt' }),
    ).not.toBeInTheDocument();
  });

  it('nennt einen anderen Konflikt als „veraltet“ am Paneel, ohne Rückfrage', async () => {
    stelleBereit(adapterFixture('a1'));
    server.use(
      http.patch('/api/admin/adapter/a1', () =>
        HttpResponse.json({ error: 'Diese Instanz meldet sich beim Hub.' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Einstellungen bearbeiten' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.type(name, ' 2');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Diese Instanz meldet sich beim Hub.')).toBeInTheDocument();
    expect(screen.queryByText('Zwischenzeitlich geändert')).not.toBeInTheDocument();
  });

  it('zeigt einen angehaltenen Adapter unbekannter Art mit „Fortsetzen“ und ohne Schreibwege', async () => {
    stelleBereit(
      adapterFixture('a1', {
        art: 'weg',
        art_bezeichnung: undefined,
        zustand: 'art_unbekannt',
        angehalten_at: '2026-11-22 08:00:00',
        geheimnisse: [],
      }),
    );
    rendere();
    expect(await screen.findByRole('button', { name: 'Fortsetzen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Verbindung prüfen' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Ziel im eigenen Netz erlauben' })).toBeDisabled();
    expect(screen.getByText(/ihre Plätze sind unbekannt/)).toBeInTheDocument();
    expect(screen.getByText('ruft nicht ab')).toBeInTheDocument();
  });

  it('setzt ein Geheimnis, ohne den Wert irgendwo zu behalten', async () => {
    const aufrufe = stelleBereit(adapterFixture('a1'));
    const user = userEvent.setup();
    const { client } = rendere();
    const zeile = await screen.findByTestId('geheimfeld-kennwort');
    await user.click(within(zeile).getByRole('button', { name: 'Setzen' }));
    await user.type(screen.getByLabelText('Neuer Wert für Kennwort des Abrufkontos'), GEHEIM);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        { methode: 'PUT', pfad: 'geheimnis/kennwort', body: { wert: GEHEIM } },
      ]),
    );
    expect(document.body.innerHTML).not.toContain(GEHEIM);
    const cache = JSON.stringify([
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    ]);
    expect(cache).not.toContain(GEHEIM);
    expect(client.getQueryData(globalKeys.adapter())).toBeDefined();
  });

  it('entfernt ein Geheimnis nach der Rückfrage', async () => {
    const aufrufe = stelleBereit(adapterFixture('a1'));
    const user = userEvent.setup();
    rendere();
    const zeile = await screen.findByTestId('geheimfeld-token');
    await user.click(within(zeile).getByRole('button', { name: 'Entfernen …' }));
    await user.click(await screen.findByRole('button', { name: 'Entfernen' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([{ methode: 'DELETE', pfad: 'geheimnis/token', body: null }]),
    );
  });

  it('sperrt die Geheimfelder ohne Schlüssel des Geheimnisspeichers', async () => {
    stelleBereit(adapterFixture('a1'), { speicher: 'fehlt', speicher_fingerabdruck: undefined });
    rendere();
    const zeile = await screen.findByTestId('geheimfeld-token');
    expect(within(zeile).getByRole('button', { name: 'Ersetzen' })).toBeDisabled();
    expect(
      screen.getByText(/Schlüssel fehlt: Geheimnisse lassen sich nicht setzen/),
    ).toBeInTheDocument();
  });

  it('erlaubt ein Ziel im eigenen Netz erst nach Rückfrage', async () => {
    const aufrufe = stelleBereit(adapterFixture('a1'));
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('switch', { name: 'Ziel im eigenen Netz erlauben' }));
    const frage = await screen.findByRole('dialog', { name: 'Ziel im eigenen Netz erlauben?' });
    expect(aufrufe).toEqual([]);
    await user.click(within(frage).getByRole('button', { name: 'Erlauben' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        {
          methode: 'PATCH',
          pfad: 'a1',
          body: { lan_erlaubt: true, basis_geaendert_at: '2026-11-21 17:04:00' },
        },
      ]),
    );
    expect(
      await screen.findByRole('switch', { name: 'Ziel im eigenen Netz erlauben' }),
    ).toBeChecked();
  });

  it('löscht nach der Rückfrage und kehrt zur Liste zurück', async () => {
    const aufrufe = stelleBereit(adapterFixture('a1'));
    const user = userEvent.setup();
    rendere();
    await user.click(await screen.findByRole('button', { name: 'Löschen …' }));
    const frage = await screen.findByRole('dialog', { name: 'Adapter a1 löschen?' });
    await user.click(within(frage).getByRole('button', { name: 'Löschen' }));
    expect(await screen.findByText('Liste der Anbindungen')).toBeInTheDocument();
    expect(aufrufe.map((a) => `${a.methode} ${a.pfad}`)).toEqual(['DELETE a1']);
  });

  it('meldet eine unbekannte Kennung', async () => {
    stelleBereit(adapterFixture('a1'));
    rendere('zz');
    expect(await screen.findByText('Adapter nicht gefunden')).toBeInTheDocument();
  });

  it('lässt die Führungskraft nur den Zustand lesen', async () => {
    vi.mocked(useAuth).mockReturnValue(
      authWertFixture(benutzerFixture({ org_rolle: 'fuehrungskraft' })),
    );
    stelleBereit(adapterFixture('a1', { einstellungen: undefined }));
    rendere();
    expect(await screen.findByRole('heading', { name: 'Zustand' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verbindung prüfen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ersetzen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('https://alarm.example/api')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Ziel im eigenen Netz erlauben' })).toBeDisabled();
  });

  it('sperrt alle Schreibwege am gekoppelten ELW', async () => {
    stelleBereit(adapterFixture('a1'), { gesperrt_grund: 'Diese Instanz meldet sich beim Hub.' });
    rendere();
    expect(await screen.findByText('Diese Instanz meldet sich beim Hub.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verbindung prüfen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anhalten' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Ersetzen' })).not.toBeInTheDocument();
  });
});
