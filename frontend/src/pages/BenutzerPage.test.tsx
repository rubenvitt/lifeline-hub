import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
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
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
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

    const evaItem = (await screen.findByText('Eva')).closest('li') as HTMLElement;
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

    const evaItem = (await screen.findByText('Eva')).closest('li') as HTMLElement;
    // Deaktivierter Nutzer zeigt keinen Deaktivieren-Button, aber Reaktivieren.
    await userEvent.click(within(evaItem).getByRole('button', { name: 'Reaktivieren' }));

    await waitFor(() => expect(patchBody).toEqual({ aktiv: true }));
    await waitFor(() =>
      expect(within(evaItem).queryByText('deaktiviert')).not.toBeInTheDocument(),
    );
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

    const evaItem = (await screen.findByText('Eva')).closest('li') as HTMLElement;
    const maxItem = (await screen.findByText('Max')).closest('li') as HTMLElement;
    await userEvent.click(within(evaItem).getByRole('button', { name: 'Reaktivieren' }));
    // Trotz laufender erster Reaktivierung muss die zweite Zeile klickbar bleiben.
    await userEvent.click(within(maxItem).getByRole('button', { name: 'Reaktivieren' }));

    await waitFor(() => expect(patchIds).toEqual([2, 3]));
    freigeben();
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
