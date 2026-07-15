import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import ProfilPage from './ProfilPage';

const { startRegistrationMock } = vi.hoisted(() => ({ startRegistrationMock: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: startRegistrationMock }));

const webauthnProvider = [
  { id: 'webauthn', typ: 'webauthn', anzeigename: 'Passkey', aktiviert: true },
];

/** `benutzer`-Fixture für `/api/auth/me` — `ProfilPage` liest `totp_aktiviert` daraus
 *  (LFH-43, Increment 5, Task 7: `useAuth().benutzer`). */
function benutzerBody(totpAktiviert: boolean) {
  return {
    id: 1,
    anzeigename: 'Admin',
    benutzername: 'admin',
    system_rolle: 'admin',
    org_rolle: 'keine',
    aktiv: true,
    erstellt_at: '2026-05-23 10:00:00',
    totp_aktiviert: totpAktiviert,
  };
}

/** ProfilPage hängt jetzt an `useAuth()` (LFH-43) — braucht `<AuthProvider>` + eine
 *  `/api/auth/me`-Antwort, sonst wirft `useAuth()` außerhalb des Providers. */
function setup(totpAktiviert = false, providerListe: unknown[] = []) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzerBody(totpAktiviert))),
    http.get('/api/auth/providers', () => HttpResponse.json(providerListe)),
  );
  return renderMitProviders(
    <AuthProvider>
      <ProfilPage />
    </AuthProvider>,
  );
}

/** `window.isSecureContext` ist in jsdom nicht zuverlässig/konfigurierbar über Node-/
 *  jsdom-Versionen hinweg (Memory: Vitest-4/jsdom-29 Test-Gotchas) — explizit setzen und
 *  per Assertion verifizieren, dass es auch wirklich griffen hat (sonst würde ein
 *  wirkungsloses defineProperty den Guard-Test aus dem falschen Grund grün machen). */
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
  startRegistrationMock.mockReset();
});

describe('ProfilPage — Passkey-Enroll (LFH-275)', () => {
  it('rendert „Passkey registrieren" bei Secure Context + aktivem webauthn-Provider und durchläuft register/start → create → finish', async () => {
    setzeSecureContext(true);
    const reihenfolge: string[] = [];
    setup(false, webauthnProvider);
    server.use(
      http.post('/api/auth/webauthn/register/start', () => {
        reihenfolge.push('start');
        return HttpResponse.json({
          publicKey: {
            rp: { name: 'lifeline-hub', id: 'localhost' },
            user: { id: 'dXNlci1oYW5kbGU', name: 'admin', displayName: 'Admin' },
            challenge: 'Y2hhbGxlbmdl',
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          },
        });
      }),
      http.post('/api/auth/webauthn/register/finish', () => {
        reihenfolge.push('finish');
        return new HttpResponse(null, { status: 201 });
      }),
    );
    startRegistrationMock.mockImplementation(async () => {
      reihenfolge.push('create');
      return {
        id: 'Y3JlZC1pZA',
        rawId: 'Y3JlZC1pZA',
        response: { attestationObject: 'YXR0ZXN0', clientDataJSON: 'Y2xpZW50RGF0YQ' },
        type: 'public-key',
        clientExtensionResults: {},
      };
    });

    const knopf = await screen.findByRole('button', { name: 'Passkey registrieren' });
    await userEvent.click(knopf);

    await waitFor(() => expect(screen.getByText('Passkey registriert')).toBeInTheDocument());
    expect(reihenfolge).toEqual(['start', 'create', 'finish']);
    expect(startRegistrationMock).toHaveBeenCalledWith({
      optionsJSON: expect.objectContaining({ challenge: 'Y2hhbGxlbmdl' }),
    });
  });

  it('zeigt eine Fehlermeldung, wenn die Registrierung fehlschlägt', async () => {
    setzeSecureContext(true);
    setup(false, webauthnProvider);
    server.use(
      http.post('/api/auth/webauthn/register/start', () =>
        HttpResponse.json({ error: 'webauthn nicht aktiv' }, { status: 404 }),
      ),
    );

    const knopf = await screen.findByRole('button', { name: 'Passkey registrieren' });
    await userEvent.click(knopf);

    expect(await screen.findByText('webauthn nicht aktiv')).toBeInTheDocument();
    expect(startRegistrationMock).not.toHaveBeenCalled();
  });

  it('zeigt KEINEN Passkey-Button ohne Secure Context, auch bei aktivem webauthn-Provider', async () => {
    setzeSecureContext(false);
    setup(false, webauthnProvider);

    // Wartet auf einen anderen Effekt der Provider-Liste (Platzhalter ist immer da) —
    // hier reicht es, sicherzustellen, dass der Button nach Ablauf der Ladezeit fehlt.
    await screen.findByText(/Profil/);
    expect(screen.queryByRole('button', { name: 'Passkey registrieren' })).not.toBeInTheDocument();
  });

  it('zeigt KEINEN Passkey-Button ohne aktiven webauthn-Provider (aber Secure Context)', async () => {
    setzeSecureContext(true);
    setup(false, []);

    await screen.findByText(/Profil/);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Passkey registrieren' })).not.toBeInTheDocument(),
    );
  });
});

describe('ProfilPage — TOTP-Enroll (LFH-43, Increment 5)', () => {
  it('zeigt „2FA einrichten", wenn totp_aktiviert=false, und durchläuft enroll/start → QR/Secret → enroll/finish → Recovery-Codes', async () => {
    setup(false);
    server.use(
      http.post('/api/auth/totp/enroll/start', () =>
        HttpResponse.json({
          otpauth_url: 'otpauth://totp/lifeline-hub:admin?secret=JBSWY3DPEHPK3PXP&issuer=lifeline-hub',
          secret_base32: 'JBSWY3DPEHPK3PXP',
        }),
      ),
      http.post('/api/auth/totp/enroll/finish', () =>
        HttpResponse.json({ recovery_codes: ['aaaa-1111', 'bbbb-2222', 'cccc-3333'] }),
      ),
    );

    const startKnopf = await screen.findByRole('button', { name: '2FA einrichten' });
    await userEvent.click(startKnopf);

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));

    expect(await screen.findByText('Recovery-Codes jetzt sichern')).toBeInTheDocument();
    expect(screen.getByText(/aaaa-1111/)).toBeInTheDocument();
    expect(screen.getByText(/bbbb-2222/)).toBeInTheDocument();
    expect(screen.getByText(/cccc-3333/)).toBeInTheDocument();
  });

  it('zeigt „2FA aktiv", wenn totp_aktiviert=true, und KEINEN Einrichten-Button', async () => {
    setup(true);

    expect(await screen.findByText('2FA aktiv')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2FA einrichten' })).not.toBeInTheDocument();
  });

  it('zeigt eine Fehlermeldung, wenn der Bestätigungscode ungültig ist', async () => {
    setup(false);
    server.use(
      http.post('/api/auth/totp/enroll/start', () =>
        HttpResponse.json({
          otpauth_url: 'otpauth://totp/lifeline-hub:admin?secret=JBSWY3DPEHPK3PXP&issuer=lifeline-hub',
          secret_base32: 'JBSWY3DPEHPK3PXP',
        }),
      ),
      http.post('/api/auth/totp/enroll/finish', () =>
        HttpResponse.json({ error: 'Code ungültig' }, { status: 422 }),
      ),
    );

    const startKnopf = await screen.findByRole('button', { name: '2FA einrichten' });
    await userEvent.click(startKnopf);
    await screen.findByText('JBSWY3DPEHPK3PXP');

    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));

    expect(await screen.findByText('Code ungültig')).toBeInTheDocument();
  });
});
