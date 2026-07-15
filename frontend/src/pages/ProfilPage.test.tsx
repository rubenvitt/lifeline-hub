import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import ProfilPage from './ProfilPage';

const { startRegistrationMock } = vi.hoisted(() => ({ startRegistrationMock: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: startRegistrationMock }));

const webauthnProvider = [
  { id: 'webauthn', typ: 'webauthn', anzeigename: 'Passkey', aktiviert: true },
];

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
    server.use(
      http.get('/api/auth/providers', () => HttpResponse.json(webauthnProvider)),
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

    renderMitProviders(<ProfilPage />);

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
    server.use(
      http.get('/api/auth/providers', () => HttpResponse.json(webauthnProvider)),
      http.post('/api/auth/webauthn/register/start', () =>
        HttpResponse.json({ error: 'webauthn nicht aktiv' }, { status: 404 }),
      ),
    );

    renderMitProviders(<ProfilPage />);

    const knopf = await screen.findByRole('button', { name: 'Passkey registrieren' });
    await userEvent.click(knopf);

    expect(await screen.findByText('webauthn nicht aktiv')).toBeInTheDocument();
    expect(startRegistrationMock).not.toHaveBeenCalled();
  });

  it('zeigt KEINEN Passkey-Button ohne Secure Context, auch bei aktivem webauthn-Provider', async () => {
    setzeSecureContext(false);
    server.use(http.get('/api/auth/providers', () => HttpResponse.json(webauthnProvider)));

    renderMitProviders(<ProfilPage />);

    // Wartet auf einen anderen Effekt der Provider-Liste (Platzhalter ist immer da) —
    // hier reicht es, sicherzustellen, dass der Button nach Ablauf der Ladezeit fehlt.
    await screen.findByText(/Profil/);
    expect(screen.queryByRole('button', { name: 'Passkey registrieren' })).not.toBeInTheDocument();
  });

  it('zeigt KEINEN Passkey-Button ohne aktiven webauthn-Provider (aber Secure Context)', async () => {
    setzeSecureContext(true);
    server.use(http.get('/api/auth/providers', () => HttpResponse.json([])));

    renderMitProviders(<ProfilPage />);

    await screen.findByText(/Profil/);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Passkey registrieren' })).not.toBeInTheDocument(),
    );
  });
});
