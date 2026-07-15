import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import LoginPage from './LoginPage';

const { startAuthenticationMock } = vi.hoisted(() => ({ startAuthenticationMock: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: startAuthenticationMock }));

function setup() {
  server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
  // Default: leere Dev-Benutzerliste → kein Picker, bestehender Test unverändert.
  server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
  // Default: keine Provider-Konfiguration → Passwort-Login bleibt sichtbar (Fallback).
  server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
  return renderMitProviders(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

describe('LoginPage', () => {
  it('zeigt eine Server-Fehlermeldung bei falschen Anmeldedaten', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: 'Nicht angemeldet' }, { status: 401 }),
      ),
    );
    setup();
    await userEvent.type(screen.getByLabelText('Benutzername'), 'admin');
    await userEvent.type(screen.getByLabelText('Passwort'), 'falsch');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(screen.getByText('Nicht angemeldet')).toBeInTheDocument());
  });

  it('füllt das Formular bei Auswahl eines Dev-Benutzers', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(
      http.get('/api/dev/users', () =>
        HttpResponse.json([
          { benutzername: 'admin', passwort: 'dev', anzeigename: 'Administrator', rolle: 'Admin' },
        ]),
      ),
    );
    server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
    renderMitProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    const knopf = await screen.findByRole('button', { name: /Administrator/ });
    await userEvent.click(knopf);

    expect((screen.getByLabelText('Benutzername') as HTMLInputElement).value).toBe('admin');
    expect((screen.getByLabelText('Passwort') as HTMLInputElement).value).toBe('dev');
  });

  it('zeigt keinen Picker, wenn der Dev-Endpoint fehlt (404)', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(
      http.get('/api/dev/users', () =>
        HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 }),
      ),
    );
    server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
    renderMitProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    expect(await screen.findByLabelText('Benutzername')).toBeInTheDocument();
    expect(screen.queryByText('Dev-Schnellanmeldung')).not.toBeInTheDocument();
  });

  it('zeigt das Passwort-Feld, wenn ein aktiver Passwort-Provider konfiguriert ist', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
    server.use(
      http.get('/api/auth/providers', () =>
        HttpResponse.json([
          { id: 'passwort', typ: 'passwort', anzeigename: 'Passwort', aktiviert: true },
        ]),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    expect(await screen.findByLabelText('Passwort')).toBeInTheDocument();
  });

  it('blendet das Passwort-Feld aus, wenn kein aktiver Passwort-Provider konfiguriert ist', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
    server.use(
      http.get('/api/auth/providers', () =>
        HttpResponse.json([{ id: 'dev', typ: 'dev', anzeigename: 'Dev', aktiviert: true }]),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    // Formular ist initial sichtbar (provider.length === 0, bevor der Effect greift) und
    // verschwindet erst, nachdem die Provider-Liste geladen ist.
    await waitFor(() => expect(screen.queryByLabelText('Passwort')).not.toBeInTheDocument());
  });

  it('blendet das Passwort-Feld aus, wenn der Passwort-Provider deaktiviert ist', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
    server.use(
      http.get('/api/auth/providers', () =>
        HttpResponse.json([
          { id: 'passwort', typ: 'passwort', anzeigename: 'Passwort', aktiviert: false },
        ]),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    // provider.length === 1 (der Safe-Default-Zweig via leerem Array kann hier nicht greifen):
    // nur `&& p.aktiviert` verhindert das Rendern. Fiele diese Bedingung weg, bliebe das
    // Passwort-Feld sichtbar, weil der `typ === 'passwort'`-Filter allein noch träfe.
    await waitFor(() => expect(screen.queryByLabelText('Passwort')).not.toBeInTheDocument());
  });

  describe('OIDC-Redirect-Button (LFH-41)', () => {
    // jsdom erlaubt kein Redefine von `window.location.assign` (nicht konfigurierbar);
    // stattdessen `location` komplett durch eine Kopie mit gemocktem `assign` ersetzen
    // und nach dem Test zurückbauen.
    const ursprünglicheLocation = window.location;

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: ursprünglicheLocation,
      });
    });

    it('rendert einen Redirect-Button für einen aktiven oidc-Provider und leitet bei Klick weiter', async () => {
      const assignSpion = vi.fn();
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...ursprünglicheLocation, assign: assignSpion },
      });
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      );
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(
        http.get('/api/auth/providers', () =>
          HttpResponse.json([
            { id: 'oidc', typ: 'oidc', anzeigename: 'PocketID', aktiviert: true },
          ]),
        ),
      );
      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      const knopf = await screen.findByRole('button', { name: 'Mit PocketID anmelden' });
      await userEvent.click(knopf);

      expect(assignSpion).toHaveBeenCalledWith('/api/auth/oidc/start?von=%2Feinsaetze');
    });

    it('zeigt keinen Redirect-Button, wenn der oidc-Provider deaktiviert ist', async () => {
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      );
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(
        http.get('/api/auth/providers', () =>
          HttpResponse.json([
            { id: 'oidc', typ: 'oidc', anzeigename: 'PocketID', aktiviert: false },
          ]),
        ),
      );
      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await screen.findByLabelText('Passwort');
      expect(screen.queryByRole('button', { name: /PocketID/ })).not.toBeInTheDocument();
    });
  });

  describe('Passkey-Login (LFH-275)', () => {
    const webauthnProvider = [
      { id: 'webauthn', typ: 'webauthn', anzeigename: 'Passkey', aktiviert: true },
    ];

    /** `window.isSecureContext` ist in jsdom nicht zuverlässig über Node-/jsdom-Versionen
     *  hinweg (Memory: Vitest-4/jsdom-29 Test-Gotchas) — explizit setzen und per Assertion
     *  verifizieren, dass es auch wirklich griffen hat. */
    function setzeSecureContext(wert: boolean) {
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: wert });
      expect(window.isSecureContext).toBe(wert);
    }

    const urspruenglicheSecureContext = window.isSecureContext;

    afterEach(() => {
      Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: urspruenglicheSecureContext,
      });
    });

    beforeEach(() => {
      startAuthenticationMock.mockReset();
    });

    it('rendert „Mit Passkey anmelden" bei Secure Context + aktivem webauthn-Provider und durchläuft auth/start → get → auth/finish → aktualisiere()', async () => {
      setzeSecureContext(true);
      const reihenfolge: string[] = [];
      // `/api/auth/me` liefert durchgehend den angemeldeten Benutzer — deckt sowohl den
      // initialen AuthProvider-Mount-Check als auch den `aktualisiere()`-Aufruf NACH
      // `auth/finish` ab (LoginPage selbst liest `benutzer` aus dem Context nicht, daher
      // unschädlich für den initialen Render). Mitgezählt via `reihenfolge.push('me')`, um
      // unten zu verifizieren, dass `aktualisiere()` (und nicht nur der Mount-Check) wirklich
      // feuert — sonst würde diese Assertion selbst bei entferntem `aktualisiere()`-Aufruf grün
      // bleiben.
      server.use(
        http.get('/api/auth/me', () => {
          reihenfolge.push('me');
          return HttpResponse.json({
            id: 1,
            anzeigename: 'Admin',
            benutzername: 'admin',
            system_rolle: 'admin',
            org_rolle: 'keine',
            aktiv: true,
            erstellt_at: '2026-05-23 10:00:00',
          });
        }),
      );
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(http.get('/api/auth/providers', () => HttpResponse.json(webauthnProvider)));
      server.use(
        http.post('/api/auth/webauthn/auth/start', () => {
          reihenfolge.push('start');
          return HttpResponse.json({
            publicKey: {
              challenge: 'Y2hhbGxlbmdl',
              rpId: 'localhost',
              allowCredentials: [],
            },
          });
        }),
        http.post('/api/auth/webauthn/auth/finish', () => {
          reihenfolge.push('finish');
          return new HttpResponse(null, { status: 200 });
        }),
      );
      startAuthenticationMock.mockImplementation(async () => {
        reihenfolge.push('get');
        return {
          id: 'Y3JlZC1pZA',
          rawId: 'Y3JlZC1pZA',
          response: {
            authenticatorData: 'YXV0aERhdGE',
            clientDataJSON: 'Y2xpZW50RGF0YQ',
            signature: 'c2ln',
          },
          type: 'public-key',
          clientExtensionResults: {},
        };
      });

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
      const knopf = screen.getByRole('button', { name: 'Mit Passkey anmelden' });
      await userEvent.click(knopf);

      // Reihenfolge OHNE die 'me'-Aufrufe: start (auth/start) → get (navigator.credentials.get
      // via startAuthentication) → finish (auth/finish) — der eigentliche Ceremony-Ablauf.
      await waitFor(() =>
        expect(reihenfolge.filter((schritt) => schritt !== 'me')).toEqual([
          'start',
          'get',
          'finish',
        ]),
      );
      expect(startAuthenticationMock).toHaveBeenCalledWith({
        optionsJSON: expect.objectContaining({ challenge: 'Y2hhbGxlbmdl' }),
      });
      // `/api/auth/me` MUSS mindestens zweimal aufgerufen worden sein: einmal beim
      // AuthProvider-Mount-Check, einmal durch `aktualisiere()` NACH `auth/finish` — sonst
      // wäre die Session zwar gesetzt, der Context aber nicht nachgezogen (genau der
      // Unterschied zum Passwort-Pfad, wo `login()` den Benutzer direkt zurückliefert).
      await waitFor(() =>
        expect(reihenfolge.filter((schritt) => schritt === 'me').length).toBeGreaterThanOrEqual(2),
      );
      // Erfolgspfad bis zum Ende durchlaufen (kein Absturz in den catch-Zweig bei
      // `aktualisiere()`) — sonst bliebe hier die Fehlermeldung stehen.
      expect(screen.queryByText('Passkey-Anmeldung fehlgeschlagen')).not.toBeInTheDocument();
    });

    it('zeigt KEINEN Passkey-Button ohne Secure Context, auch bei aktivem webauthn-Provider', async () => {
      setzeSecureContext(false);
      server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(http.get('/api/auth/providers', () => HttpResponse.json(webauthnProvider)));

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await screen.findByLabelText('Benutzername');
      expect(
        screen.queryByRole('button', { name: 'Mit Passkey anmelden' }),
      ).not.toBeInTheDocument();
    });

    it('zeigt KEINEN Passkey-Button ohne aktiven webauthn-Provider (aber Secure Context)', async () => {
      setzeSecureContext(true);
      server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(
        http.get('/api/auth/providers', () =>
          HttpResponse.json([
            { id: 'passwort', typ: 'passwort', anzeigename: 'Passwort', aktiviert: true },
          ]),
        ),
      );

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await screen.findByLabelText('Benutzername');
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Mit Passkey anmelden' }),
        ).not.toBeInTheDocument(),
      );
    });
  });
});
