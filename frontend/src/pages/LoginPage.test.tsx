import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { BENUTZER_PRUEFEN } from '../auth/sitzungsEvent';
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
  it('übersetzt den generischen 401 („Nicht angemeldet") in eine verständliche Login-Meldung', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: 'Nicht angemeldet' }, { status: 401 }),
      ),
    );
    setup();
    await userEvent.type(screen.getByLabelText('Benutzername'), 'admin');
    await userEvent.type(screen.getByLabelText('Passwort'), 'falsch');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() =>
      expect(screen.getByText('Benutzername oder Passwort ist falsch')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Nicht angemeldet')).not.toBeInTheDocument();
  });

  it('reicht Nicht-401-Serverfehler unverändert durch (z. B. 503)', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: 'Dienst derzeit nicht verfügbar' }, { status: 503 }),
      ),
    );
    setup();
    await userEvent.type(screen.getByLabelText('Benutzername'), 'admin');
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() =>
      expect(screen.getByText('Dienst derzeit nicht verfügbar')).toBeInTheDocument(),
    );
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

    // Das Formular ist initial sichtbar (provider.length === 0, bevor der Effect greift) und
    // verschwindet erst nach geladener Provider-Liste.
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

    // provider.length === 1 (der Safe-Default über leeres Array greift nicht): nur `&& p.aktiviert`
    // verhindert das Rendern. Fiele es weg, bliebe das Passwort-Feld sichtbar.
    await waitFor(() => expect(screen.queryByLabelText('Passwort')).not.toBeInTheDocument());
  });

  describe('OIDC-Redirect-Button (LFH-41)', () => {
    // jsdom erlaubt kein Redefine von `window.location.assign`; `location` wird durch eine Kopie
    // mit gemocktem `assign` ersetzt und nach dem Test zurückgebaut.
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

    it('zeigt eine Fehlermeldung, wenn der OIDC-Callback auf /login?fehler=oidc zurückleitet', async () => {
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      );
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
        { route: '/login?fehler=oidc' },
      );

      expect(
        await screen.findByText('Die Anmeldung über Single Sign-On ist fehlgeschlagen'),
      ).toBeInTheDocument();
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

    /**
     * `window.isSecureContext` ist in jsdom nicht verlässlich — explizit setzen und per Assertion
     * prüfen, dass es gegriffen hat.
     */
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

    it('rendert „Mit Passkey anmelden" bei Secure Context + aktivem webauthn-Provider und durchläuft discoverable/start → get → discoverable/finish → aktualisiere() OHNE Benutzername', async () => {
      setzeSecureContext(true);
      const reihenfolge: string[] = [];
      // `/api/auth/me` liefert durchgehend den angemeldeten Benutzer — für den Mount-Check und den
      // `aktualisiere()`-Aufruf nach `auth/finish`. Mitgezählt (`reihenfolge.push('me')`), um zu
      // belegen, dass `aktualisiere()` wirklich feuert, nicht nur der Mount-Check.
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
        http.post('/api/auth/webauthn/discoverable/start', () => {
          reihenfolge.push('start');
          return HttpResponse.json({
            publicKey: {
              challenge: 'Y2hhbGxlbmdl',
              rpId: 'localhost',
              allowCredentials: [],
            },
          });
        }),
        http.post('/api/auth/webauthn/discoverable/finish', () => {
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

      // Kein Benutzername: usernameless Login. Der Passkey-Knopf erscheint erst mit geladener
      // Provider-Liste (webauthn aktiv) → `findByRole` wartet.
      const knopf = await screen.findByRole('button', { name: 'Mit Passkey anmelden' });
      // Im reinen Passkey-Setup gibt es kein Benutzername-Feld (es hängt an `passwortAktiv`). Erst
      // nach dem `findByRole` prüfen — vorher, bei provider=[], stünde das Feld noch da.
      expect(screen.queryByLabelText('Benutzername')).not.toBeInTheDocument();
      await userEvent.click(knopf);

      // Reihenfolge ohne die 'me'-Aufrufe: start (discoverable/start) → get
      // (navigator.credentials.get) → finish (discoverable/finish).
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
      // `/api/auth/me` mindestens zweimal: beim Mount-Check und durch `aktualisiere()` nach
      // `auth/finish` — sonst wäre die Session gesetzt, der Context aber nicht nachgezogen (anders
      // als beim Passwort-Pfad, wo `login()` den Benutzer liefert).
      await waitFor(() =>
        expect(reihenfolge.filter((schritt) => schritt === 'me').length).toBeGreaterThanOrEqual(2),
      );
      // Erfolgspfad bis zum Ende (kein Absturz in den catch-Zweig bei `aktualisiere()`).
      expect(screen.queryByText('Passkey-Anmeldung fehlgeschlagen')).not.toBeInTheDocument();
    });

    it('lässt während der Passkey-Ceremony nur den Passkey-Button laden, nicht „Anmelden"', async () => {
      setzeSecureContext(true);
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      );
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(
        http.get('/api/auth/providers', () =>
          HttpResponse.json([
            { id: 'passwort', typ: 'passwort', anzeigename: 'Passwort', aktiviert: true },
            { id: 'webauthn', typ: 'webauthn', anzeigename: 'Passkey', aktiviert: true },
          ]),
        ),
      );
      server.use(
        http.post('/api/auth/webauthn/discoverable/start', () =>
          HttpResponse.json({
            publicKey: { challenge: 'Y2hhbGxlbmdl', rpId: 'localhost', allowCredentials: [] },
          }),
        ),
      );
      // Die Ceremony hängt absichtlich (Promise bleibt offen) → der Ladezustand ist stabil
      // beobachtbar.
      startAuthenticationMock.mockImplementation(() => new Promise(() => {}));

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      // Kein Benutzername nötig. Beide Provider aktiv → „Anmelden" und Passkey-Knopf sind da; nur
      // der Passkey-Knopf darf während der Ceremony laden.
      const passkeyKnopf = await screen.findByRole('button', { name: 'Mit Passkey anmelden' });
      await userEvent.click(passkeyKnopf);

      await waitFor(() => expect(passkeyKnopf).toHaveClass('ant-btn-loading'));
      expect(screen.getByRole('button', { name: 'Anmelden' })).not.toHaveClass('ant-btn-loading');
    });

    it('zeigt KEINEN Passkey-Button ohne Secure Context, auch bei aktivem webauthn-Provider', async () => {
      setzeSecureContext(false);
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      );
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
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      );
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

  describe('Zweite Login-Stufe (LFH-43, TOTP)', () => {
    const adminBody = {
      id: 1,
      anzeigename: 'Admin',
      benutzername: 'admin',
      system_rolle: 'admin',
      org_rolle: 'keine',
      aktiv: true,
      erstellt_at: '2026-05-23 10:00:00',
    };

    it('schaltet bei „mfa_erforderlich" auf die TOTP-Code-Eingabe um und schließt über totp/finish + aktualisiere() ab', async () => {
      const reihenfolge: string[] = [];
      server.use(
        http.get('/api/auth/me', () => {
          reihenfolge.push('me');
          return HttpResponse.json(adminBody);
        }),
      );
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
      server.use(
        http.post('/api/auth/login', () => {
          reihenfolge.push('login');
          // Untagged Union: ein TOTP-Nutzer bekommt die schmale Form statt eines Benutzers — keine
          // Session an dieser Stelle.
          return HttpResponse.json({ mfa_erforderlich: 'totp' });
        }),
        http.post('/api/auth/totp/finish', () => {
          reihenfolge.push('totpFinish');
          return HttpResponse.json(adminBody);
        }),
      );

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
      await userEvent.type(screen.getByLabelText('Passwort'), 'geheim');
      await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

      // Die erste Stufe (Passwort) weicht der Code-Eingabe.
      const codeFeld = await screen.findByLabelText('Code aus deiner Authenticator-App');
      expect(screen.queryByLabelText('Passwort')).not.toBeInTheDocument();

      // Kein Klick auf „Anmelden": die sechste Ziffer sendet selbst ab. Der Knopf bleibt als
      // Rückfallweg und wird unten eigens geprüft.
      await userEvent.type(codeFeld, '123456');

      // Reihenfolge ohne die 'me'-Aufrufe: login (mfa_erforderlich) → totpFinish. `aktualisiere()`
      // löst einen weiteren 'me'-Aufruf aus; das Herausfiltern macht die Assertion robust gegen
      // dessen Anzahl.
      await waitFor(() =>
        expect(reihenfolge.filter((schritt) => schritt !== 'me')).toEqual(['login', 'totpFinish']),
      );
      // Erfolgspfad bis zum Ende (kein Absturz in den catch-Zweig).
      expect(screen.queryByText('Code ungültig')).not.toBeInTheDocument();
    });

    // Der Rückfallweg: ein unvollständiger Code geht weiterhin über den Knopf raus.
    it('sendet einen unvollstaendigen Code weiterhin ueber den Anmelden-Knopf', async () => {
      const gesendet: string[] = [];
      server.use(
        http.get('/api/dev/users', () => HttpResponse.json([])),
        http.get('/api/auth/providers', () => HttpResponse.json([])),
        http.post('/api/auth/login', () => HttpResponse.json({ mfa_erforderlich: 'totp' })),
        http.post('/api/auth/totp/finish', async ({ request }) => {
          gesendet.push(((await request.json()) as { code: string }).code);
          return HttpResponse.json(adminBody);
        }),
      );

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
      await userEvent.type(screen.getByLabelText('Passwort'), 'geheim');
      await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

      const codeFeld = await screen.findByLabelText('Code aus deiner Authenticator-App');
      await userEvent.type(codeFeld, '12345');
      expect(gesendet).toEqual([]);

      await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
      await waitFor(() => expect(gesendet).toEqual(['12345']));
    });

    // Ein TOTP-Code ist serverseitig genau einmal gültig: ein zweiter Aufruf meldete „Code
    // ungültig" für einen Code, der gerade funktioniert hat.
    it('schickt den Code auch dann nur EINMAL, wenn nach der sechsten Ziffer noch geklickt wird', async () => {
      let aufrufe = 0;
      server.use(
        http.get('/api/dev/users', () => HttpResponse.json([])),
        http.get('/api/auth/providers', () => HttpResponse.json([])),
        http.post('/api/auth/login', () => HttpResponse.json({ mfa_erforderlich: 'totp' })),
        http.post('/api/auth/totp/finish', async () => {
          aufrufe += 1;
          // Verzögert, damit der Klick den laufenden Absendevorgang trifft. Die Frist ist
          // großzügig, weil `userEvent.click` auf langsamer Hardware (Coverage, zwei CI-Kerne)
          // länger braucht; sie kostet nichts, der Test wartet ohnehin auf den Absendevorgang.
          await new Promise((r) => setTimeout(r, 2000));
          return HttpResponse.json(adminBody);
        }),
      );

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
      await userEvent.type(screen.getByLabelText('Passwort'), 'geheim');
      await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

      const codeFeld = await screen.findByLabelText('Code aus deiner Authenticator-App');
      await userEvent.type(codeFeld, '123456');
      // `getByRole` statt eines bedingten Klicks: verschwände der Knopf, degenerierte der Test
      // still zu „ein Aufruf".
      //
      // Der Name ist ein Teilstring: die sechste Ziffer sendet selbst ab, der Knopf steht gerade
      // auf `loading`, und antd hängt dem Ladeicon ein eigenes `aria-label` („loading") an — der
      // Knopf heißt in diesem Moment „loading Anmelden". Ein exakter Name träfe ihn nur, solange
      // der Ladezustand noch nicht gerendert ist.
      await userEvent.click(screen.getByRole('button', { name: /Anmelden/ }));

      await waitFor(() => expect(aufrufe).toBeGreaterThan(0));
      expect(aufrufe).toBe(1);
    });

    it('richtet die Code-Eingabe auf Ziffern aus (inputMode, one-time-code, maxLength)', async () => {
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      );
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
      server.use(
        http.post('/api/auth/login', () => HttpResponse.json({ mfa_erforderlich: 'totp' })),
      );

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
      await userEvent.type(screen.getByLabelText('Passwort'), 'geheim');
      await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

      const codeFeld = await screen.findByLabelText('Code aus deiner Authenticator-App');
      expect(codeFeld).toHaveAttribute('inputmode', 'numeric');
      expect(codeFeld).toHaveAttribute('autocomplete', 'one-time-code');
      expect(codeFeld).toHaveAttribute('maxlength', '6');
    });

    it('schaltet per „Recovery-Code verwenden" auf die Recovery-Eingabe um und schickt den Code an totp/finish', async () => {
      let totpBody: unknown = null;
      server.use(http.get('/api/auth/me', () => HttpResponse.json(adminBody)));
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
      server.use(
        http.post('/api/auth/login', () => HttpResponse.json({ mfa_erforderlich: 'totp' })),
        http.post('/api/auth/totp/finish', async ({ request }) => {
          totpBody = await request.json();
          return HttpResponse.json(adminBody);
        }),
      );

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
      await userEvent.type(screen.getByLabelText('Passwort'), 'geheim');
      await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

      await screen.findByLabelText('Code aus deiner Authenticator-App');
      await userEvent.click(screen.getByRole('button', { name: 'Recovery-Code verwenden' }));

      const recoveryFeld = await screen.findByLabelText('Recovery-Code');
      expect(screen.queryByLabelText('Code aus deiner Authenticator-App')).not.toBeInTheDocument();

      await userEvent.type(recoveryFeld, 'a1b2-c3d4-e5f6-0718-293a');
      await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

      await waitFor(() => expect(totpBody).toEqual({ code: 'a1b2-c3d4-e5f6-0718-293a' }));
    });

    it('führt aus der Recovery-Eingabe zurück zur Code-Eingabe', async () => {
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      );
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
      server.use(
        http.post('/api/auth/login', () => HttpResponse.json({ mfa_erforderlich: 'totp' })),
      );

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
      await userEvent.type(screen.getByLabelText('Passwort'), 'geheim');
      await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

      await screen.findByLabelText('Code aus deiner Authenticator-App');
      await userEvent.click(screen.getByRole('button', { name: 'Recovery-Code verwenden' }));
      await screen.findByLabelText('Recovery-Code');

      await userEvent.click(
        screen.getByRole('button', { name: 'Code aus der Authenticator-App verwenden' }),
      );

      expect(await screen.findByLabelText('Code aus deiner Authenticator-App')).toBeInTheDocument();
      expect(screen.queryByLabelText('Recovery-Code')).not.toBeInTheDocument();
    });

    it('meldet einen normalen (Nicht-MFA) Login unverändert direkt an — keine Code-Eingabe', async () => {
      server.use(
        http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      );
      server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
      server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));
      server.use(http.post('/api/auth/login', () => HttpResponse.json(adminBody)));

      renderMitProviders(
        <AuthProvider>
          <LoginPage />
        </AuthProvider>,
      );

      await userEvent.type(await screen.findByLabelText('Benutzername'), 'admin');
      await userEvent.type(screen.getByLabelText('Passwort'), 'geheim');
      await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

      await waitFor(() =>
        expect(
          screen.queryByLabelText('Code aus deiner Authenticator-App'),
        ).not.toBeInTheDocument(),
      );
      expect(screen.queryByText('Verbindung zum Server fehlgeschlagen')).not.toBeInTheDocument();
    });
  });

  /** LFH-387: meldet sich in einem anderen Tab jemand an, zieht die Anmeldeseite nach. */
  describe('Anmeldung aus einem anderen Tab', () => {
    const anna = {
      id: 1,
      anzeigename: 'Anna Admin',
      benutzername: 'anna',
      system_rolle: 'admin',
      org_rolle: 'keine',
      aktiv: true,
      erstellt_at: '2026-05-23 10:00:00',
    };

    function zeigeLoginMitZiel(angemeldet: boolean) {
      let sitzung: typeof anna | null = angemeldet ? anna : null;
      server.use(
        http.get('/api/auth/me', () =>
          sitzung ? HttpResponse.json(sitzung) : HttpResponse.json({ error: 'x' }, { status: 401 }),
        ),
        http.get('/api/dev/users', () => HttpResponse.json([])),
        http.get('/api/auth/providers', () => HttpResponse.json([])),
      );
      renderMitProviders(
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/einsaetze" element={<div>Einsatzliste</div>} />
          </Routes>
        </AuthProvider>,
        { route: '/login' },
      );
      return { anmelden: () => (sitzung = anna) };
    }

    it('übernimmt eine Anmeldung aus einem anderen Tab und verlässt die Anmeldeseite', async () => {
      const { anmelden } = zeigeLoginMitZiel(false);
      await screen.findByLabelText('Benutzername');
      anmelden();
      act(() => void window.dispatchEvent(new Event(BENUTZER_PRUEFEN)));
      expect(await screen.findByText('Einsatzliste')).toBeInTheDocument();
    });

    it('lässt eine schon angemeldete Person auf der Anmeldeseite (Benutzerwechsel bleibt möglich)', async () => {
      zeigeLoginMitZiel(true);
      await screen.findByLabelText('Benutzername');
      act(() => void window.dispatchEvent(new Event(BENUTZER_PRUEFEN)));
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByText('Einsatzliste')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Benutzername')).toBeInTheDocument();
    });
  });
});
