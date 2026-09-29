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

/** `benutzer`-Fixture für `/api/auth/me` — `ProfilPage` liest `totp_aktiviert` daraus. */
function benutzerBody(totpAktiviert: boolean) {
  return {
    id: 1,
    // Bewusst nicht „Admin": der Anzeigename stünde sonst gleichlautend neben der
    // Rollen-Beschriftung, und `getByText('Admin')` träfe beide.
    anzeigename: 'Rita Beispiel',
    benutzername: 'admin',
    system_rolle: 'admin',
    org_rolle: 'keine',
    aktiv: true,
    erstellt_at: '2026-05-23 10:00:00',
    totp_aktiviert: totpAktiviert,
  };
}

/** ProfilPage hängt an `useAuth()` — den `AuthProvider` hängt `renderMitProviders` ein, der
 *  Benutzer kommt aus der `/api/auth/me`-Antwort. */
function setup(totpAktiviert = false, providerListe: unknown[] = []) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzerBody(totpAktiviert))),
    http.get('/api/auth/providers', () => HttpResponse.json(providerListe)),
    // Die Organisation steht nicht am Benutzer; die Kopfsektion holt sie aus `GET
    // /api/organisation`.
    http.get('/api/organisation', () =>
      HttpResponse.json({ id: 1, name: 'DRK Musterstadt', tz_organisation: null }),
    ),
  );
  return renderMitProviders(<ProfilPage />);
}

/**
 * `window.isSecureContext` ist in jsdom nicht verlässlich — explizit setzen und per Assertion
 * prüfen, dass es gegriffen hat (sonst machte ein wirkungsloses defineProperty den Guard-Test aus
 * dem falschen Grund grün).
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
  startRegistrationMock.mockReset();
});

/** Kopfsektion mit Name, Rolle und Organisation des eigenen Kontos. */
describe('ProfilPage — Kopfdaten (LFH-345)', () => {
  it('zeigt Anzeigename, Benutzername und Systemrolle', async () => {
    setup();

    expect(await screen.findByText('Rita Beispiel')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    // Die Rolle als Wort, nicht als Wire-Wert. Die Schreibweise folgt `BenutzerPage` („Admin" /
    // „Führungskraft" / „Benutzer"), damit dieselbe Rolle nicht zwei Namen trägt.
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('zeigt die Organisation', async () => {
    setup();
    expect(await screen.findByText('DRK Musterstadt')).toBeInTheDocument();
  });

  // Die Organisation kommt aus einem eigenen Abruf; fällt der aus, zeigt die Seite „—" wie bei
  // jeder unbekannten Angabe.
  it('bleibt lesbar, wenn die Organisation nicht ladbar ist', async () => {
    server.use(http.get('/api/organisation', () => HttpResponse.json({}, { status: 500 })));
    setup();

    expect(await screen.findByText('Rita Beispiel')).toBeInTheDocument();
    expect(screen.getByText('Organisation')).toBeInTheDocument();
  });

  it('endet nicht mehr im Baustellen-Platzhalter', async () => {
    setup();

    await screen.findByText('Zwei-Faktor (TOTP)');
    expect(screen.queryByText('Eigener Account und app-weite Einstellungen.')).toBeNull();
  });

  it('fasst die Sicherheits-Abschnitte unter einer Ueberschrift zusammen', async () => {
    setup();
    expect(await screen.findByText('Sicherheit')).toBeInTheDocument();
  });
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

    // Wartet auf einen anderen Effekt der Provider-Liste — hier reicht, dass der Knopf nach der
    // Ladezeit fehlt.
    await screen.findByText(/Profil/);
    expect(screen.queryByRole('button', { name: 'Passkey registrieren' })).not.toBeInTheDocument();
  });

  it('zeigt KEINEN Passkey-Button ohne aktiven webauthn-Provider (aber Secure Context)', async () => {
    setzeSecureContext(true);
    setup(false, []);

    await screen.findByText(/Profil/);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Passkey registrieren' }),
      ).not.toBeInTheDocument(),
    );
  });
});

/**
 * Die sechste Ziffer sendet selbst ab; der Knopf bleibt als Rückfallweg und wird eigens geprüft,
 * ebenso der Riegel gegen doppeltes Absenden.
 */
describe('ProfilPage — TOTP-Enroll (LFH-43, Increment 5)', () => {
  it('zeigt „2FA einrichten", wenn totp_aktiviert=false, und durchläuft enroll/start → QR/Secret → enroll/finish → Recovery-Codes', async () => {
    setup(false);
    server.use(
      http.post('/api/auth/totp/enroll/start', () =>
        HttpResponse.json({
          otpauth_url:
            'otpauth://totp/lifeline-hub:admin?secret=JBSWY3DPEHPK3PXP&issuer=lifeline-hub',
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

  // Der Rückfallweg: der Knopf trägt einen unvollständigen Code, den das Auto-Absenden nicht
  // anfasst.
  it('sendet einen unvollstaendigen Code weiterhin ueber den Bestaetigen-Knopf', async () => {
    setup(false);
    const gesendet: string[] = [];
    server.use(
      http.post('/api/auth/totp/enroll/start', () =>
        HttpResponse.json({
          otpauth_url:
            'otpauth://totp/lifeline-hub:admin?secret=JBSWY3DPEHPK3PXP&issuer=lifeline-hub',
          secret_base32: 'JBSWY3DPEHPK3PXP',
        }),
      ),
      http.post('/api/auth/totp/enroll/finish', async ({ request }) => {
        gesendet.push(((await request.json()) as { code: string }).code);
        return HttpResponse.json({ recovery_codes: ['aaaa-1111'] });
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: '2FA einrichten' }));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '12345');
    expect(gesendet).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(gesendet).toEqual(['12345']));
  });

  /**
   * Nach dem Auto-Absenden gibt es hier keinen zweiten Weg: mit dem Erfolg fällt `totpEnrollment`
   * auf `null`, der Enrollment-Zweig samt Knopf verschwindet. Der Doppelaufruf ist strukturell
   * ausgeschlossen.
   *
   * Der Riegel bleibt trotzdem richtig — er deckt den Klick während des laufenden Requests, den
   * `userEvent` nicht nachstellen kann. Belegt ist er auf der Anmeldeseite, wo der Knopf nach
   * `totpFinish` stehen bleibt.
   */
  it('schickt den Code nach dem Auto-Absenden genau einmal — und laesst keinen zweiten Weg stehen', async () => {
    setup(false);
    let aufrufe = 0;
    server.use(
      http.post('/api/auth/totp/enroll/start', () =>
        HttpResponse.json({
          otpauth_url:
            'otpauth://totp/lifeline-hub:admin?secret=JBSWY3DPEHPK3PXP&issuer=lifeline-hub',
          secret_base32: 'JBSWY3DPEHPK3PXP',
        }),
      ),
      http.post('/api/auth/totp/enroll/finish', async () => {
        aufrufe += 1;
        // Verzögert, damit der Klick den laufenden Absendevorgang trifft — ein sofort auflösender
        // Handler ließe den Riegel schon gefallen sein.
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ recovery_codes: ['aaaa-1111'] });
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: '2FA einrichten' }));
    await screen.findByText('JBSWY3DPEHPK3PXP');

    const feld = screen.getByLabelText('Code aus deiner Authenticator-App');
    await userEvent.type(feld, '123456');

    await screen.findByText('Recovery-Codes jetzt sichern');
    expect(aufrufe).toBe(1);
    // Die zweite Hälfte: der Knopf ist weg. Ohne diese Aussage könnte der Test grün sein, obwohl
    // ein zweiter Absendeweg offenstünde.
    expect(screen.queryByRole('button', { name: 'Bestätigen' })).toBeNull();
  });

  it('zeigt eine Fehlermeldung, wenn der Bestätigungscode ungültig ist', async () => {
    setup(false);
    server.use(
      http.post('/api/auth/totp/enroll/start', () =>
        HttpResponse.json({
          otpauth_url:
            'otpauth://totp/lifeline-hub:admin?secret=JBSWY3DPEHPK3PXP&issuer=lifeline-hub',
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

    expect(await screen.findByText('Code ungültig')).toBeInTheDocument();
  });

  it('behält die Recovery-Codes sichtbar, wenn der Status-Refresh nach enrollFinish auf „2FA aktiv" dreht (Regressionsschutz)', async () => {
    setup(false);
    server.use(
      http.post('/api/auth/totp/enroll/start', () =>
        HttpResponse.json({
          otpauth_url:
            'otpauth://totp/lifeline-hub:admin?secret=JBSWY3DPEHPK3PXP&issuer=lifeline-hub',
          secret_base32: 'JBSWY3DPEHPK3PXP',
        }),
      ),
      http.post('/api/auth/totp/enroll/finish', () =>
        HttpResponse.json({ recovery_codes: ['CODE-1111', 'CODE-2222'] }),
      ),
    );

    const startKnopf = await screen.findByRole('button', { name: '2FA einrichten' });
    await userEvent.click(startKnopf);

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    // Ab hier liefert /api/auth/me totp_aktiviert=true — der Status-Refresh, den
    // `totpBestaetigen()` per `aktualisiere()` nach enrollFinish auslöst. Die Recovery-Codes liegen
    // in eigenem State (`recoveryCodes`), entkoppelt von `benutzer.totp_aktiviert` — genau das
    // prüft dieser Test.
    server.use(http.get('/api/auth/me', () => HttpResponse.json(benutzerBody(true))));

    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '123456');

    expect(await screen.findByText('2FA aktiv')).toBeInTheDocument();
    expect(screen.getByText(/CODE-1111/)).toBeInTheDocument();
    expect(screen.getByText(/CODE-2222/)).toBeInTheDocument();
  });
});

/**
 * Der Ein-Klick-Weg zu Codes, die nur einmal angezeigt werden. Im Nicht-Secure-Context war er
 * vorher ein stiller No-Op (`navigator.clipboard?.writeText(...).catch(() => {})`).
 *
 * Falle: `userEvent.setup()` installiert einen eigenen Clipboard-Stub, die direkte
 * `userEvent.click`-API nicht. Diese Datei nutzt durchgehend die direkte API — mit `setup()` prüfte
 * der Erfolgsfall userEvents Stub statt der Seite.
 */
describe('ProfilPage — Recovery-Codes kopieren (LFH-370)', () => {
  /** Fährt den Enroll-Weg bis zur Anzeige der Codes. */
  async function bisZuDenCodes() {
    setup(false);
    server.use(
      http.post('/api/auth/totp/enroll/start', () =>
        HttpResponse.json({
          otpauth_url:
            'otpauth://totp/lifeline-hub:admin?secret=JBSWY3DPEHPK3PXP&issuer=lifeline-hub',
          secret_base32: 'JBSWY3DPEHPK3PXP',
        }),
      ),
      http.post('/api/auth/totp/enroll/finish', () =>
        HttpResponse.json({ recovery_codes: ['aaaa-1111', 'bbbb-2222'] }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: '2FA einrichten' }));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '123456');
    await screen.findByText('Recovery-Codes jetzt sichern');
  }

  function setzeZwischenablage(wert: unknown) {
    Object.defineProperty(navigator, 'clipboard', {
      value: wert,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    setzeZwischenablage(undefined);
  });

  it('meldet den Erfolg — und legt die Codes tatsaechlich ab', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setzeZwischenablage({ writeText });
    await bisZuDenCodes();

    await userEvent.click(screen.getByRole('button', { name: 'Codes kopieren' }));

    expect(writeText).toHaveBeenCalledWith('aaaa-1111\nbbbb-2222');
    expect(await screen.findByText('Recovery-Codes kopiert')).toBeInTheDocument();
  });

  it('meldet auch die ABLEHNUNG — vorhanden heisst nicht erlaubt', async () => {
    // Zwei Zweige, weil `writeText` da sein und trotzdem ablehnen kann (NotAllowedError, fehlende
    // Berechtigung).
    setzeZwischenablage({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    await bisZuDenCodes();

    await userEvent.click(screen.getByRole('button', { name: 'Codes kopieren' }));

    expect(await screen.findByText(/Kopieren fehlgeschlagen/)).toBeInTheDocument();
  });

  it('zeigt OHNE Zwischenablage keinen toten Knopf, sondern den Weg zum Markieren', async () => {
    setzeZwischenablage(undefined);
    await bisZuDenCodes();

    expect(screen.queryByRole('button', { name: 'Codes kopieren' })).not.toBeInTheDocument();
    expect(screen.getByText(/lassen\s+sich markieren und kopieren/)).toBeInTheDocument();
    // Die Codes bleiben erreichbar — der Hinweis verweist auf sie, statt einen zweiten Mechanismus
    // zu bauen.
    expect(screen.getByText(/aaaa-1111/)).toBeInTheDocument();
  });
});
