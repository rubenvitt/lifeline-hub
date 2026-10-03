import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import RequireAuth from '../routes/RequireAuth';
import AppAnmeldungPage from './AppAnmeldungPage';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const CODE = '0123456789abcdef'.repeat(4);

const ANGEMELDET = {
  id: 4,
  anzeigename: 'Gerda Maier',
  benutzername: 'gerda',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-09-30',
  totp_aktiviert: false,
  passwort_gesetzt: true,
};

function LoginZiel() {
  const location = useLocation();
  return <p>Anmeldung, zurück nach {(location.state as { von?: string } | null)?.von}</p>;
}

function setup(route: string, navigiere = vi.fn()) {
  renderMitProviders(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/app-anmeldung" element={<AppAnmeldungPage navigiere={navigiere} />} />
      </Route>
      <Route path="/login" element={<LoginZiel />} />
    </Routes>,
    { route },
  );
  return navigiere;
}

function angemeldet() {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(ANGEMELDET)));
}

describe('AppAnmeldungPage (LFH-818)', () => {
  it('führt ohne Sitzung zur Anmeldung und behält die challenge im Rückweg', async () => {
    setup(`/app-anmeldung?challenge=${CHALLENGE}`);
    expect(
      await screen.findByText(`Anmeldung, zurück nach /app-anmeldung?challenge=${CHALLENGE}`),
    ).toBeInTheDocument();
  });

  it('nennt die angemeldete Person und fordert noch keinen Code an', async () => {
    angemeldet();
    const ausgestellt = vi.fn();
    server.use(
      http.post('/api/auth/app-code', () => {
        ausgestellt();
        return HttpResponse.json({ code: CODE });
      }),
    );
    setup(`/app-anmeldung?challenge=${CHALLENGE}`);
    expect(
      await screen.findByRole('heading', { name: 'In der Mac-App anmelden als Gerda Maier' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In der App anmelden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mit anderem Konto' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Bestätige nur, wenn du gerade in der Mac-App auf „Im Browser anmelden“ geklickt hast.',
      ),
    ).toBeInTheDocument();
    expect(ausgestellt).not.toHaveBeenCalled();
  });

  it('fordert bei einem schnellen Doppelklick nur einen Code an', async () => {
    angemeldet();
    const ausgestellt = vi.fn();
    server.use(
      http.post('/api/auth/app-code', async () => {
        ausgestellt();
        await new Promise((r) => setTimeout(r, 30));
        return HttpResponse.json({ code: CODE });
      }),
    );
    const navigiere = setup(`/app-anmeldung?challenge=${CHALLENGE}`);
    const knopf = await screen.findByRole('button', { name: 'In der App anmelden' });
    knopf.click();
    knopf.click();
    await waitFor(() => expect(navigiere).toHaveBeenCalledTimes(1));
    expect(ausgestellt).toHaveBeenCalledTimes(1);
  });

  it('fordert nach der Zustimmung den Code an und springt zurück in die App', async () => {
    angemeldet();
    let body: unknown = null;
    server.use(
      http.post('/api/auth/app-code', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ code: CODE });
      }),
    );
    const navigiere = setup(`/app-anmeldung?challenge=${CHALLENGE}`);
    await userEvent.click(await screen.findByRole('button', { name: 'In der App anmelden' }));

    await waitFor(() =>
      expect(navigiere).toHaveBeenCalledWith(`lifeline://anmeldung?code=${CODE}`),
    );
    expect(body).toEqual({ challenge: CHALLENGE });
    expect(await screen.findByText(/Du kannst dieses Fenster schließen/)).toBeInTheDocument();
    // Der Code steht nie auf der Seite.
    expect(document.body.textContent).not.toContain(CODE);
  });

  it('meldet einen Fehler beim Ausstellen an der Seite und springt nicht', async () => {
    angemeldet();
    server.use(
      http.post('/api/auth/app-code', () =>
        HttpResponse.json({ error: 'Dienst derzeit nicht verfügbar' }, { status: 503 }),
      ),
    );
    const navigiere = setup(`/app-anmeldung?challenge=${CHALLENGE}`);
    await userEvent.click(await screen.findByRole('button', { name: 'In der App anmelden' }));
    expect(await screen.findByText('Dienst derzeit nicht verfügbar')).toBeInTheDocument();
    expect(navigiere).not.toHaveBeenCalled();
    // antd lässt das ausgeblendete Lade-Icon im Namen stehen; bedienbar ist der Knopf trotzdem.
    const knopf = screen.getByRole('button', { name: /In der App anmelden/ });
    await waitFor(() => expect(knopf).not.toHaveClass('ant-btn-loading'));
    expect(knopf).toBeEnabled();
  });

  it('fragt bei fehlender oder kaputter challenge nichts an', async () => {
    angemeldet();
    const ausgestellt = vi.fn();
    server.use(
      http.post('/api/auth/app-code', () => {
        ausgestellt();
        return HttpResponse.json({ code: CODE });
      }),
    );
    for (const route of ['/app-anmeldung', '/app-anmeldung?challenge=kurz']) {
      const { unmount } = renderMitProviders(<AppAnmeldungPage navigiere={vi.fn()} />, { route });
      expect(
        await screen.findByText(
          'Dieser Link ist unvollständig. Starte die Anmeldung in der Mac-App erneut.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'In der App anmelden' })).toBeNull();
      unmount();
    }
    expect(ausgestellt).not.toHaveBeenCalled();
  });

  it('meldet bei „Mit anderem Konto“ im Browser ab und führt zur Anmeldung mit Rückweg', async () => {
    let angemeldetNoch = true;
    server.use(
      http.get('/api/auth/me', () =>
        angemeldetNoch
          ? HttpResponse.json(ANGEMELDET)
          : HttpResponse.json({ error: 'Nicht angemeldet' }, { status: 401 }),
      ),
      http.post('/api/auth/logout', () => {
        angemeldetNoch = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    setup(`/app-anmeldung?challenge=${CHALLENGE}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Mit anderem Konto' }));
    expect(
      await screen.findByText(`Anmeldung, zurück nach /app-anmeldung?challenge=${CHALLENGE}`),
    ).toBeInTheDocument();
  });
});
