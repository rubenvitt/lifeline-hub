import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import BenutzerPage from './BenutzerPage';

function benutzer(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
    org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', ...over,
  };
}

describe('BenutzerPage', () => {
  it('listet Benutzer', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => HttpResponse.json([benutzer()])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );
    // Benutzername-Zelle (@admin) ist eindeutig — der Name „Admin" kollidiert sonst mit dem Rollen-Tag.
    expect(await screen.findByText('@admin')).toBeInTheDocument();
  });

  it('legt einen neuen Benutzer an', async () => {
    let angelegt = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json(angelegt ? [benutzer(), benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' })] : [benutzer()]),
      ),
      http.post('/api/benutzer', () => {
        angelegt = true;
        return HttpResponse.json(benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva' }), {
          status: 201,
        });
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await userEvent.type(screen.getByLabelText('Anzeigename'), 'Eva');
    await userEvent.type(screen.getByLabelText('Benutzername'), 'eva');
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim123');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(screen.getByText('Eva')).toBeInTheDocument());
  });

  it('bearbeitet den Anzeigenamen eines Benutzers', async () => {
    let patchBody: Record<string, unknown> | null = null;
    let bearbeitet = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({
            id: 2,
            anzeigename: bearbeitet ? 'Eva Neu' : 'Eva',
            benutzername: 'eva',
            system_rolle: 'keiner',
          }),
        ]),
      ),
      http.patch('/api/benutzer/2', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        bearbeitet = true;
        return HttpResponse.json(
          benutzer({ id: 2, anzeigename: 'Eva Neu', benutzername: 'eva', system_rolle: 'keiner' }),
        );
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );

    const evaItem = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    await userEvent.click(within(evaItem).getByRole('button', { name: 'Bearbeiten' }));

    const input = await screen.findByLabelText('Anzeigename');
    await userEvent.clear(input);
    await userEvent.type(input, 'Eva Neu');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).toMatchObject({ anzeigename: 'Eva Neu' });
    await waitFor(() => expect(screen.getByText('Eva Neu')).toBeInTheDocument());
  });

  it('reaktiviert einen deaktivierten Benutzer', async () => {
    let patchBody: Record<string, unknown> | null = null;
    let reaktiviert = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({
            id: 2,
            anzeigename: 'Eva',
            benutzername: 'eva',
            system_rolle: 'keiner',
            aktiv: reaktiviert,
          }),
        ]),
      ),
      http.patch('/api/benutzer/2', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        reaktiviert = true;
        return HttpResponse.json(
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' }),
        );
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );

    const evaItem = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    // Deaktivierter Nutzer zeigt keinen Deaktivieren-Button, aber Reaktivieren.
    await userEvent.click(within(evaItem).getByRole('button', { name: 'Reaktivieren' }));

    await waitFor(() => expect(patchBody).toEqual({ aktiv: true }));
    // Nach dem Refetch rendert die Tabelle neu — Zeile frisch holen statt stale Referenz.
    await waitFor(() => {
      const zeile = screen.getByText('Eva').closest('tr') as HTMLElement;
      expect(within(zeile).queryByText('deaktiviert')).not.toBeInTheDocument();
    });
  });

  it('sperrt beim Reaktivieren nur die geklickte Zeile, nicht alle', async () => {
    const patchIds: number[] = [];
    // Default-No-op: der Executor läuft synchron und ersetzt ihn sofort durch den echten Resolver.
    let freigeben: () => void = () => {};
    const blockiert = new Promise<void>((res) => {
      freigeben = () => res();
    });
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner', aktiv: false }),
          benutzer({ id: 3, anzeigename: 'Max', benutzername: 'max', system_rolle: 'keiner', aktiv: false }),
        ]),
      ),
      http.patch('/api/benutzer/:id', async ({ params }) => {
        patchIds.push(Number(params.id));
        await blockiert; // erste Anfrage bewusst in-flight halten
        return HttpResponse.json(benutzer({ id: Number(params.id), aktiv: true }));
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );

    const evaItem = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    const maxItem = (await screen.findByText('Max')).closest('tr') as HTMLElement;
    await userEvent.click(within(evaItem).getByRole('button', { name: 'Reaktivieren' }));
    // Trotz laufender erster Reaktivierung muss die zweite Zeile klickbar bleiben.
    await userEvent.click(within(maxItem).getByRole('button', { name: 'Reaktivieren' }));

    await waitFor(() => expect(patchIds).toEqual([2, 3]));
    freigeben();
  });

  /**
   * LFH-346 · A1: „Deaktivieren" trug ÜBERHAUPT keine Ladeanzeige — anders als
   * „Reaktivieren" daneben, das seit jeher zeilenweise scopt. Ein Klick auf eine
   * unumkehrbar wirkende Aktion ohne jede Rückmeldung lädt zum zweiten Klick ein.
   *
   * Die zweite Zeile ist die schärfere Hälfte: ein ungescoptes
   * `loading={deaktivieren.isPending}` erfüllte die erste Erwartung ebenfalls.
   */
  it('zeigt den Ladezustand beim Deaktivieren NUR an der geklickten Zeile', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' }),
          benutzer({ id: 3, anzeigename: 'Max', benutzername: 'max', system_rolle: 'keiner' }),
        ]),
      ),
      http.post('/api/benutzer/:id/deaktivieren', () => new Promise(() => {})),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );

    const evaZeile = (await screen.findByText('Eva')).closest('tr') as HTMLElement;
    const maxZeile = (await screen.findByText('Max')).closest('tr') as HTMLElement;
    await userEvent.click(within(evaZeile).getByRole('button', { name: 'Deaktivieren' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ja' }));

    await waitFor(() =>
      expect(within(evaZeile).getByRole('button', { name: /Deaktivieren/ })).toHaveClass(
        'ant-btn-loading',
      ),
    );
    expect(within(maxZeile).getByRole('button', { name: 'Deaktivieren' })).not.toHaveClass(
      'ant-btn-loading',
    );
  });

  // Ordnung statt bloßer Anwesenheit: geprüft wird, was Suche, Sortierung und Statusfilter mit
  // den Zeilen TUN. Die stehende Kopfzeile schiebt eine verborgene Messzeile als erste
  // Körperzeile ein, deshalb die Verengung auf `tr.ant-table-row`.
  it('sucht, sortiert und filtert die Benutzerliste', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () =>
        HttpResponse.json([
          benutzer(),
          benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner', aktiv: false }),
        ]),
      ),
    );
    const { container } = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );
    await screen.findByText('@eva');
    const namen = () =>
      Array.from(container.querySelectorAll('tr.ant-table-row td:first-child')).map(
        (z) => z.textContent,
      );
    expect(namen()).toEqual(['Admin', 'Eva']);

    // Gesucht wird der Rohwert: „eva", nicht das gerenderte „@eva".
    const feld = screen.getByPlaceholderText('Name oder Benutzername');
    await userEvent.type(feld, 'eva');
    await waitFor(() => expect(namen()).toEqual(['Eva']));
    await userEvent.clear(feld);
    await waitFor(() => expect(namen()).toHaveLength(2));

    // Zweimal klicken: aufsteigend ist hier die Serverreihenfolge, erst absteigend beweist,
    // dass wirklich sortiert wird.
    const kopf = screen.getByRole('columnheader', { name: /Name/ });
    await userEvent.click(kopf);
    await userEvent.click(kopf);
    await waitFor(() => expect(namen()).toEqual(['Eva', 'Admin']));

    // Der Filterkorb hängt in einem Portal an `document.body`, nicht im Container.
    const status = screen.getByRole('columnheader', { name: /Status/ });
    await userEvent.click(status.querySelector('.ant-table-filter-trigger') as HTMLElement);
    const korb = document.querySelector('.ant-table-filter-dropdown') as HTMLElement;
    await userEvent.click(within(korb).getByText('deaktiviert'));
    // `test/utils.tsx` montiert `ConfigProvider` ohne Locale — die Schaltfläche heißt „OK".
    await userEvent.click(within(korb).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(namen()).toEqual(['Eva']));
  });

  /**
   * Das Partnerpaar zu AK4 (LFH-331 · B3). Die negative Hälfte allein belegte nichts:
   * änderte man den Leertext beim Umbau, wäre sie auch im Leerfall trivial grün. Erst
   * die positive Hälfte darunter — gleiches Literal, gleiche Datei — macht sie zu einer
   * Aussage über die Zustandsweiche statt über die Schreibweise eines Strings.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Benutzer')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(benutzer())),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );

    expect(await screen.findByText('Noch keine Benutzer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('leitet Nicht-Admins weg von der Benutzerverwaltung', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ ...benutzer(), system_rolle: 'keiner' }),
      ),
      http.get('/api/benutzer', () => HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
          <Route path="/einsaetze" element={<div>Einsatz-Liste</div>} />
        </Routes>
      </AuthProvider>,
      { route: '/admin/benutzer' },
    );
    expect(await screen.findByText('Einsatz-Liste')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Benutzer anlegen' })).not.toBeInTheDocument();
  });
});
