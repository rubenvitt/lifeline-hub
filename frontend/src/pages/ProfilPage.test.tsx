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
    // Bewusst NICHT „Admin": der Anzeigename stand sonst gleichlautend neben der
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

/** ProfilPage hängt jetzt an `useAuth()` (LFH-43) — braucht `<AuthProvider>` + eine
 *  `/api/auth/me`-Antwort, sonst wirft `useAuth()` außerhalb des Providers. */
function setup(totpAktiviert = false, providerListe: unknown[] = []) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzerBody(totpAktiviert))),
    http.get('/api/auth/providers', () => HttpResponse.json(providerListe)),
    // Die Organisation steht NICHT am Benutzer (`BenutzerAnzeige` kennt sie nicht) —
    // die Kopfsektion holt sie aus `GET /api/organisation` (LFH-345 · C10, N5).
    http.get('/api/organisation', () =>
      HttpResponse.json({ id: 1, name: 'DRK Musterstadt', tz_organisation: null }),
    ),
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

/**
 * Kopfsektion statt Baustellen-Platzhalter (LFH-345 · C10, Befund N5).
 *
 * Die Seite endete in einem `<Platzhalter titel="Profil">` — ausgerechnet unter zwei
 * fertigen Sicherheits-Abschnitten stand „hier entsteht etwas". Wer sein eigenes Konto
 * ansah, fand weder Namen noch Rolle noch Organisation.
 */
describe('ProfilPage — Kopfdaten (LFH-345)', () => {
  it('zeigt Anzeigename, Benutzername und Systemrolle', async () => {
    setup();

    expect(await screen.findByText('Rita Beispiel')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    // Die Rolle als WORT, nicht als Wire-Wert — dieselbe Regel wie beim Einsatz-Status.
    // Die Schreibweise folgt `BenutzerPage` („Admin" / „Führungskraft" / „Benutzer"),
    // damit dieselbe Rolle nicht an zwei Stellen zwei Namen trägt.
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('zeigt die Organisation', async () => {
    setup();
    expect(await screen.findByText('DRK Musterstadt')).toBeInTheDocument();
  });

  // Die Organisation kommt aus einem eigenen Abruf; faellt der aus, darf die Seite nicht
  // leer bleiben — sie zeigt dann „—" wie jede andere unbekannte Angabe.
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
      expect(
        screen.queryByRole('button', { name: 'Passkey registrieren' }),
      ).not.toBeInTheDocument(),
    );
  });
});

/**
 * Seit LFH-345 · C10 (M20) sendet die SECHSTE ZIFFER selbst ab — die Klicks auf
 * „Bestätigen" sind aus den Abläufen unten deshalb verschwunden, nicht vergessen worden.
 * Der Knopf bleibt als Rückfallweg und wird eigens geprüft (s. „Rückfallweg" unten), ebenso
 * der Riegel gegen den doppelten Absendeversuch.
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

  // Der Rückfallweg (LFH-345 · C10, M20): der Knopf bleibt und trägt einen unvollständigen
  // Code, den das Auto-Absenden nicht anfasst. Ohne diese Aussage wäre die Bündelung oben
  // nicht von „der Knopf ist weg" zu unterscheiden.
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
   * Nach dem Auto-Absenden gibt es hier keinen zweiten Weg mehr — und das ist gemessen,
   * nicht angenommen.
   *
   * Der erste Anlauf dieses Tests klickte nach der sechsten Ziffer zusätzlich auf
   * „Bestätigen" und erwartete dank `sendetRef` genau einen Aufruf. Der Klick schlug fehl:
   * mit dem Erfolg fällt `totpEnrollment` auf `null`, der ganze Enrollment-Zweig
   * verschwindet, und mit ihm der Knopf. Auf dieser Seite ist der Doppelaufruf also
   * strukturell ausgeschlossen statt nur verriegelt.
   *
   * Der Riegel bleibt trotzdem richtig — er deckt den Klick WÄHREND des laufenden Requests,
   * den `userEvent` nicht nachstellen kann (es wartet die Zusage ab). Belegt ist er auf der
   * Anmeldeseite, wo der Knopf nach `totpFinish` stehen bleibt.
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
        // Verzoegert, damit der Klick den laufenden Absendevorgang tatsaechlich trifft —
        // ein sofort aufloesender Handler liesse den Riegel schon wieder gefallen sein.
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
    // Die zweite Haelfte, und der Grund fuer die Umformulierung: der Knopf ist WEG. Ohne
    // diese Aussage koennte der Test auch dann gruen sein, wenn ein zweiter Absendeweg
    // offenstuende und nur zufaellig nicht benutzt wurde.
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

    // Ab hier liefert /api/auth/me totp_aktiviert=true — simuliert den Status-Refresh, den
    // `totpBestaetigen()` per `aktualisiere()` NACH erfolgreichem enrollFinish auslöst
    // (ProfilPage.tsx). Die Recovery-Codes liegen dabei in eigenem State (`recoveryCodes`),
    // entkoppelt von `benutzer.totp_aktiviert` — genau das prüft dieser Test.
    server.use(http.get('/api/auth/me', () => HttpResponse.json(benutzerBody(true))));

    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '123456');

    expect(await screen.findByText('2FA aktiv')).toBeInTheDocument();
    expect(screen.getByText(/CODE-1111/)).toBeInTheDocument();
    expect(screen.getByText(/CODE-2222/)).toBeInTheDocument();
  });
});

/**
 * Der einzige Ein-Klick-Weg zu Codes, die nur EINMAL angezeigt werden (LFH-370 · B5j,
 * Befund M17). Vorher klickte ihn kein einziger Test — und er war im Nicht-Secure-Context
 * ein stiller No-Op, weil `navigator.clipboard?.writeText(...).catch(() => {})` die ganze
 * Kette kurzschloss.
 *
 * FALLE, gemessen: `userEvent.setup()` installiert einen EIGENEN Clipboard-Stub, die
 * direkte `userEvent.click`-API nicht. Diese Datei nutzt durchgehend die direkte API —
 * wer sie auf `setup()` umstellt, macht den Fallback-Test still grün und prüft im
 * Erfolgsfall userEvents Stub statt der Seite.
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
    // Der Grund für zwei Zweige statt eines: `writeText` kann da sein und trotzdem
    // ablehnen (NotAllowedError, fehlende Berechtigung).
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
    // Die Codes selbst bleiben erreichbar — der Hinweis verweist auf sie, statt einen
    // zweiten Mechanismus zu bauen.
    expect(screen.getByText(/aaaa-1111/)).toBeInTheDocument();
  });
});
