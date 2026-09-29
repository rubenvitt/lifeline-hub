import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import type { BenutzerAnzeige } from '../api/types';
import { lagebildAnlegen, lagebildLesen } from '../offline/lagebildSpeicher';
import { HOECHSTLIEGEZEIT_MS } from '../offline/lagebildStart';
import {
  SITZUNG_ABGELAUFEN,
  meldeSitzungAbgelaufen,
  sitzungsMeldungZuruecksetzen,
} from './sitzungsEvent';

afterEach(() => sitzungsMeldungZuruecksetzen());

function Anzeige() {
  const { benutzer, laedt, login, logout } = useAuth();
  if (laedt) return <div>lädt…</div>;
  return (
    <div>
      <span data-testid="name">{benutzer ? benutzer.anzeigename : 'anonym'}</span>
      <button onClick={() => login('admin', 'pw')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

const adminBody = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

describe('AuthContext', () => {
  it('zeigt anonym, wenn /me 401 liefert', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
  });

  it('übernimmt den Benutzer nach erfolgreichem Login', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      http.post('/api/auth/login', () => HttpResponse.json(adminBody)),
    );
    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));
  });

  it('meldet lokal ab, auch wenn der Server-Logout scheitert (LFH-268)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(adminBody)),
      // session::loeschen propagiert seinen AppError (src/routes/auth.rs:226) — ein
      // SQLITE_BUSY unter Last reicht für einen 5xx.
      http.post('/api/auth/logout', () =>
        HttpResponse.json({ error: 'Datenbank belegt' }, { status: 500 }),
      ),
    );
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));

    await userEvent.click(screen.getByText('logout'));

    // Bliebe `benutzer` gesetzt, ließe RequireAuth geschützte Routen weiter passieren —
    // und die Sitzungswache meldete wegen ihrer Sperre keinen weiteren Ablauf mehr.
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    expect(konsole).toHaveBeenCalled();
    konsole.mockRestore();
  });

  it('löst die Melde-Sperre nach erfolgreichem Login (LFH-268)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      http.post('/api/auth/login', () => HttpResponse.json(adminBody)),
    );
    // Sperre setzen — wie nach einem echten Sitzungsablauf.
    meldeSitzungAbgelaufen();

    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));

    // Ohne das Lösen bliebe ein SPÄTERER Ablauf in derselben Browser-Sitzung stumm.
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    meldeSitzungAbgelaufen();
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });
});

describe('AuthContext — Lagebild ohne Netz (LFH-723)', () => {
  const personen = [{ id: 1, name: 'Vorgehalten' }];

  /** Legt einen gültigen Stand des Admins mit einer Personenliste von Einsatz 3 an. */
  async function standAnlegen(bestaetigtAt = Date.now()) {
    const quelle = new QueryClient();
    quelle.setQueryData(einsatzKeys.personen(3), personen);
    await lagebildAnlegen({
      benutzer: adminBody as unknown as BenutzerAnzeige,
      bestaetigtAt,
      buster: __APP_VERSION__,
      client: {
        timestamp: Date.now(),
        buster: __APP_VERSION__,
        clientState: dehydrate(quelle),
      },
    });
  }

  /** Eigener Client mit Vorgabe-`gcTime`: der Testclient (`gcTime: 0`) räumte einen
   *  wiederhergestellten, unbeobachteten Eintrag sofort ab — genau der Fall, gegen den der
   *  Produktionsclient die Allowlist auf 24 h hält (design.md D8). */
  function rendern() {
    return renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    );
  }

  it('meldet bei Netzfehler mit gültigem Stand den zuletzt bestätigten Benutzer an', async () => {
    await standAnlegen();
    server.use(http.get('/api/auth/me', () => HttpResponse.error()));
    const { client } = rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));
    expect(client.getQueryData(einsatzKeys.personen(3))).toEqual(personen);
  });

  it('behandelt ein Gateway „nicht erreichbar" (503) wie einen Netzfehler', async () => {
    await standAnlegen();
    server.use(http.get('/api/auth/me', () => new HttpResponse(null, { status: 503 })));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));
  });

  it('bleibt bei Netzfehler ohne Stand anonym wie bisher', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.error()));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
  });

  it('bleibt bei Netzfehler mit einem Stand älter als 24 h anonym und löscht ihn', async () => {
    await standAnlegen(Date.now() - HOECHSTLIEGEZEIT_MS - 60_000);
    server.use(http.get('/api/auth/me', () => HttpResponse.error()));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    expect(await lagebildLesen()).toBeUndefined();
  });

  it('löscht bei 401 den Stand und stellt nichts in den Speicher', async () => {
    await standAnlegen();
    server.use(http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })));
    const { client } = rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    expect(client.getQueryData(einsatzKeys.personen(3))).toBeUndefined();
    expect(await lagebildLesen()).toBeUndefined();
  });

  it('stellt einer anderen Person nichts vom vorherigen Benutzer bereit', async () => {
    await standAnlegen();
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ ...adminBody, id: 2, anzeigename: 'Zweite' }),
      ),
    );
    const { client } = rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Zweite'));
    expect(client.getQueryData(einsatzKeys.personen(3))).toBeUndefined();
    // Serverbestätigt steht der Name, bevor der Start den Datensatz ersetzt hat.
    await waitFor(async () => expect((await lagebildLesen())?.benutzer.id).toBe(2));
    expect((await lagebildLesen())?.client.clientState.queries).toEqual([]);
  });

  it('löscht beim Abmelden Speicher und Platte, auch wenn der Server-Logout scheitert', async () => {
    await standAnlegen();
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(adminBody)),
      http.post('/api/auth/logout', () => HttpResponse.json({ error: 'x' }, { status: 500 })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));
    // Serverbestätigt liegt der Stand auf der Platte, nicht im Speicher (design.md D2); im
    // Speicher steht, was die Sitzung selbst geladen hat.
    client.setQueryData(einsatzKeys.einheiten(3), [{ id: 9 }]);
    await waitFor(async () =>
      expect((await lagebildLesen())?.client.clientState.queries.map((q) => q.queryKey[0])).toEqual(
        expect.arrayContaining(['einsatz-personen', 'einsatz-einheiten']),
      ),
    );
    await userEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    expect(client.getQueryData(einsatzKeys.einheiten(3))).toBeUndefined();
    expect(await lagebildLesen()).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('räumt bei der Anmeldung einer anderen Person den Stand der vorherigen', async () => {
    await standAnlegen();
    server.use(
      http.get('/api/auth/me', () => HttpResponse.error()),
      http.post('/api/auth/login', () =>
        HttpResponse.json({ ...adminBody, id: 2, anzeigename: 'Zweite' }),
      ),
    );
    const { client } = rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Zweite'));
    expect(client.getQueryData(einsatzKeys.personen(3))).toBeUndefined();
    expect((await lagebildLesen())?.benutzer.id).toBe(2);
  });
});
