import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beendeHuelle, starteMacHuelle } from '../test/huelle';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import ProfilPage from './ProfilPage';

const { startRegistrationMock } = vi.hoisted(() => ({ startRegistrationMock: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: startRegistrationMock }));

const passwortProvider = [
  { id: 'passwort', typ: 'passwort', anzeigename: 'Passwort', aktiviert: true },
];

const webauthnProvider = [
  { id: 'webauthn', typ: 'webauthn', anzeigename: 'Passkey', aktiviert: true },
];

/** `benutzer`-Fixture für `/api/auth/me` — `ProfilPage` liest `totp_aktiviert` und
 *  `passwort_gesetzt` daraus. */
function benutzerBody(totpAktiviert: boolean, passwortGesetzt = true) {
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
    passwort_gesetzt: passwortGesetzt,
  };
}

/** ProfilPage hängt an `useAuth()` — den `AuthProvider` hängt `renderMitProviders` ein, der
 *  Benutzer kommt aus der `/api/auth/me`-Antwort. */
function setup(totpAktiviert = false, providerListe: unknown[] = [], passwortGesetzt = true) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzerBody(totpAktiviert, passwortGesetzt))),
    http.get('/api/auth/providers', () => HttpResponse.json(providerListe)),
    // Die Organisation steht nicht am Benutzer; die Kopfsektion holt sie aus `GET
    // /api/organisation`.
    http.get('/api/organisation', () =>
      HttpResponse.json({ id: 1, name: 'DRK Musterstadt', tz_organisation: null }),
    ),
  );
  return renderMitProviders(<ProfilPage />);
}

/** Startet die TOTP-Einrichtung über den Passwortschritt (LFH-1013): Knopf, aktuelles Passwort,
 *  „Weiter". */
async function einrichtungMitPasswort(passwort = 'startpw12') {
  await userEvent.click(await screen.findByRole('button', { name: 'Zweiten Faktor einrichten' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Aktuelles Passwort'), passwort);
  await userEvent.click(within(dialog).getByRole('button', { name: /Weiter/ }));
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

    await screen.findByText('Rita Beispiel');
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

// Die macOS-Hülle kann keinen Passkey ausführen und sagt es selbst (LFH-817): keine Einrichtung,
// stattdessen ein Satz, wo es geht.
describe('ProfilPage — macOS-Hülle ohne Passkey (LFH-817)', () => {
  afterEach(beendeHuelle);

  it('bietet in der Hülle keine Einrichtung an und nennt den Browser', async () => {
    setzeSecureContext(true);
    starteMacHuelle();
    setup(false, webauthnProvider);

    expect(await screen.findByText('Nur im Browser verfügbar.')).toBeInTheDocument();
    expect(screen.getByText('Passkey')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Passkey registrieren' })).not.toBeInTheDocument();
  });

  it('nennt in der Hülle mit „Im Browser anmelden“ den Weg in die Mac-App (LFH-818)', async () => {
    setzeSecureContext(true);
    starteMacHuelle({ invoke: vi.fn().mockResolvedValue(undefined) });
    setup(false, webauthnProvider);

    expect(
      await screen.findByText('Nur im Browser einrichtbar; Anmeldung über „Im Browser anmelden“.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Passkey registrieren' })).not.toBeInTheDocument();
  });

  it('zeigt den Hinweis nicht ohne aktiven webauthn-Provider', async () => {
    setzeSecureContext(true);
    starteMacHuelle();
    setup(false, passwortProvider);

    // Anker: die Provider-Liste ist geladen.
    await screen.findByRole('button', { name: 'Passwort ändern' });
    await waitFor(() => expect(screen.queryByText(/Nur im Browser/)).not.toBeInTheDocument());
  });

  it('bietet ohne Kennung die Einrichtung wie bisher an (Gegenprobe)', async () => {
    setzeSecureContext(true);
    setup(false, webauthnProvider);

    expect(await screen.findByRole('button', { name: 'Passkey registrieren' })).toBeInTheDocument();
    expect(screen.queryByText(/Nur im Browser/)).not.toBeInTheDocument();
  });
});

/**
 * Die sechste Ziffer sendet selbst ab; der Knopf bleibt als Rückfallweg und wird eigens geprüft,
 * ebenso der Riegel gegen doppeltes Absenden.
 */
describe('ProfilPage — TOTP-Enroll (LFH-43, Increment 5)', () => {
  it('zeigt „Zweiten Faktor einrichten", wenn totp_aktiviert=false, und durchläuft enroll/start → QR/Schlüssel → enroll/finish → Wiederherstellungscodes', async () => {
    setup(false, passwortProvider);
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

    await einrichtungMitPasswort();

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    // Ein Wort für die Sache, kein Entwicklerjargon (LFH-944).
    expect(screen.getByText(/Schlüssel zur manuellen Eingabe/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/TOTP|Secret|2FA/);

    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '123456');

    expect(await screen.findByText('Wiederherstellungscodes jetzt sichern')).toBeInTheDocument();
    expect(screen.getByText(/aaaa-1111/)).toBeInTheDocument();
    expect(screen.getByText(/bbbb-2222/)).toBeInTheDocument();
    expect(screen.getByText(/cccc-3333/)).toBeInTheDocument();
  });

  it('zeigt „Zweiter Faktor aktiv", wenn totp_aktiviert=true, und KEINEN Einrichten-Button', async () => {
    setup(true);

    expect(await screen.findByText('Zweiter Faktor aktiv')).toBeInTheDocument();
    expect(screen.getByText('Abschalten kann nur ein Administrator.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/self-service|Admin-Reset|2FA|TOTP/);
    expect(
      screen.queryByRole('button', { name: 'Zweiten Faktor einrichten' }),
    ).not.toBeInTheDocument();
  });

  // Der Rückfallweg: der Knopf trägt einen unvollständigen Code, den das Auto-Absenden nicht
  // anfasst.
  it('sendet einen unvollstaendigen Code weiterhin ueber den Bestaetigen-Knopf', async () => {
    setup(false, passwortProvider);
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

    await einrichtungMitPasswort();
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
    setup(false, passwortProvider);
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

    await einrichtungMitPasswort();
    await screen.findByText('JBSWY3DPEHPK3PXP');

    const feld = screen.getByLabelText('Code aus deiner Authenticator-App');
    await userEvent.type(feld, '123456');

    await screen.findByText('Wiederherstellungscodes jetzt sichern');
    expect(aufrufe).toBe(1);
    // Die zweite Hälfte: der Knopf ist weg. Ohne diese Aussage könnte der Test grün sein, obwohl
    // ein zweiter Absendeweg offenstünde.
    expect(screen.queryByRole('button', { name: 'Bestätigen' })).toBeNull();
  });

  it('zeigt eine Fehlermeldung, wenn der Bestätigungscode ungültig ist', async () => {
    setup(false, passwortProvider);
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

    await einrichtungMitPasswort();
    await screen.findByText('JBSWY3DPEHPK3PXP');

    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '000000');

    expect(await screen.findByText('Code ungültig')).toBeInTheDocument();
  });

  it('behält die Wiederherstellungscodes sichtbar, wenn der Status-Refresh nach enrollFinish auf „Zweiter Faktor aktiv" dreht (Regressionsschutz)', async () => {
    setup(false, passwortProvider);
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

    await einrichtungMitPasswort();

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    // Ab hier liefert /api/auth/me totp_aktiviert=true — der Status-Refresh, den
    // `totpBestaetigen()` per `aktualisiere()` nach enrollFinish auslöst. Die Recovery-Codes liegen
    // in eigenem State (`recoveryCodes`), entkoppelt von `benutzer.totp_aktiviert` — genau das
    // prüft dieser Test.
    server.use(http.get('/api/auth/me', () => HttpResponse.json(benutzerBody(true))));

    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '123456');

    expect(await screen.findByText('Zweiter Faktor aktiv')).toBeInTheDocument();
    expect(screen.getByText(/CODE-1111/)).toBeInTheDocument();
    expect(screen.getByText(/CODE-2222/)).toBeInTheDocument();
  });
});

/**
 * Die Einrichtung verlangt das aktuelle Passwort (LFH-1013): sonst richtete jemand mit einer
 * fremden Sitzung seinen eigenen Zweitfaktor ein. Ohne nutzbares lokales Passwort gibt es keine
 * Einrichtung, denn der Zweitfaktor schützt nur die Passwort-Anmeldung.
 */
describe('ProfilPage — TOTP-Einrichtung nur mit Passwort (LFH-1013)', () => {
  const startAntwort = {
    otpauth_url: 'otpauth://totp/lifeline-hub:admin?secret=JBSWY3DPEHPK3PXP&issuer=lifeline-hub',
    secret_base32: 'JBSWY3DPEHPK3PXP',
  };

  it('fragt vor dem QR-Code das aktuelle Passwort ab und schickt es mit', async () => {
    setup(false, passwortProvider);
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/auth/totp/enroll/start', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json(startAntwort);
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Zweiten Faktor einrichten' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).toBeNull();
    expect(gesendet).toEqual([]);

    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Aktuelles Passwort'), 'startpw12');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weiter/ }));

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(gesendet).toEqual([{ passwort: 'startpw12' }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('zeigt ein falsches Passwort im Dialog und keinen QR-Code', async () => {
    setup(false, passwortProvider);
    server.use(
      http.post('/api/auth/totp/enroll/start', () =>
        HttpResponse.json({ error: 'Das Passwort stimmt nicht.' }, { status: 422 }),
      ),
    );

    await einrichtungMitPasswort('falsch123');

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Das Passwort stimmt nicht/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Aktuelles Passwort')).toHaveValue('falsch123');
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).toBeNull();
  });

  it('sendet ohne Passwort nicht', async () => {
    setup(false, passwortProvider);
    let aufrufe = 0;
    server.use(
      http.post('/api/auth/totp/enroll/start', () => {
        aufrufe += 1;
        return HttpResponse.json(startAntwort);
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Zweiten Faktor einrichten' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weiter/ }));

    expect(
      await within(dialog).findByText('Bitte das aktuelle Passwort eingeben'),
    ).toBeInTheDocument();
    expect(aufrufe).toBe(0);
  });

  // Anker wie beim Passwortwechsel: der Passkey-Knopf belegt die geladene Provider-Liste, der
  // Anzeigename den geladenen Benutzer. Erst dann trägt die Abwesenheit etwas.
  it('bietet einem SSO-only-Konto keine Einrichtung an', async () => {
    setzeSecureContext(true);
    setup(false, [...passwortProvider, ...webauthnProvider], false);
    await screen.findByRole('button', { name: 'Passkey registrieren' });
    await screen.findByText('Rita Beispiel');
    expect(
      screen.queryByRole('button', { name: 'Zweiten Faktor einrichten' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Zweiter Faktor (Code aus App)')).toBeNull();
  });

  it('bietet ohne aktiven Passwort-Provider keine Einrichtung an', async () => {
    setzeSecureContext(true);
    setup(false, [{ ...passwortProvider[0], aktiviert: false }, ...webauthnProvider]);
    await screen.findByRole('button', { name: 'Passkey registrieren' });
    await screen.findByText('Rita Beispiel');
    expect(
      screen.queryByRole('button', { name: 'Zweiten Faktor einrichten' }),
    ).not.toBeInTheDocument();
  });

  it('zeigt einen schon aktiven Zweitfaktor auch ohne lokales Passwort', async () => {
    setup(true, passwortProvider, false);

    expect(await screen.findByText('Zweiter Faktor aktiv')).toBeInTheDocument();
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
    setup(false, passwortProvider);
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
    await einrichtungMitPasswort();
    await screen.findByText('JBSWY3DPEHPK3PXP');
    await userEvent.type(screen.getByLabelText('Code aus deiner Authenticator-App'), '123456');
    await screen.findByText('Wiederherstellungscodes jetzt sichern');
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
    expect(await screen.findByText('Wiederherstellungscodes kopiert')).toBeInTheDocument();
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
    expect(screen.getByText('Keine Zwischenablage auf dieser Verbindung')).toBeInTheDocument();
    // Die Codes bleiben erreichbar — der Hinweis verweist auf sie, statt einen zweiten Mechanismus
    // zu bauen.
    expect(screen.getByText(/aaaa-1111/)).toBeInTheDocument();
  });
});

/**
 * Self-Service-Passwortwechsel (LFH-471). Der Abschnitt hängt am aktiven Passwort-Provider — die
 * Negativaussage steht neben der positiven, sonst belegte die positive nichts (ein Abschnitt, der
 * immer erscheint, bestünde sie auch).
 */
describe('ProfilPage — Passwort ändern (LFH-471)', () => {
  /** Öffnet den Dialog und liefert ihn. */
  async function dialogOeffnen() {
    await userEvent.click(await screen.findByRole('button', { name: 'Passwort ändern' }));
    return screen.findByRole('dialog');
  }

  async function ausfuellen(dialog: HTMLElement, alt: string, neu: string, wiederholung = neu) {
    await userEvent.type(within(dialog).getByLabelText('Bisheriges Passwort'), alt);
    await userEvent.type(within(dialog).getByLabelText('Neues Passwort'), neu);
    await userEvent.type(within(dialog).getByLabelText('Neues Passwort wiederholen'), wiederholung);
  }

  it('erscheint, wenn der Passwort-Provider aktiv ist', async () => {
    setup(false, passwortProvider);
    expect(await screen.findByRole('button', { name: 'Passwort ändern' })).toBeInTheDocument();
  });

  it('erscheint NICHT ohne aktiven Passwort-Provider', async () => {
    setzeSecureContext(true);
    setup(false, webauthnProvider);
    // Anker: die Seite ist fertig geladen, erst dann trägt die Abwesenheit etwas.
    await screen.findByRole('button', { name: 'Passkey registrieren' });
    await waitFor(() => expect(screen.queryByText('Passwort')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Passwort ändern' })).toBeNull();
  });

  /**
   * SSO-only-Konto (LFH-828): Es hat kein lokales Passwort, der Server lehnte jeden Wechsel mit
   * 422 ab. Der Passkey-Knopf belegt, dass die Provider-Liste geladen ist, der Anzeigename, dass
   * der Benutzer geladen ist. Erst dann trägt die Abwesenheit etwas.
   */
  it('erscheint NICHT für ein SSO-only-Konto, auch bei aktivem Passwort-Provider', async () => {
    setzeSecureContext(true);
    setup(false, [...passwortProvider, ...webauthnProvider], false);
    await screen.findByRole('button', { name: 'Passkey registrieren' });
    await screen.findByText('Rita Beispiel');
    expect(screen.queryByText('Passwort')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Passwort ändern' })).toBeNull();
  });

  it('erscheint für ein Konto mit lokalem Passwort (Gegenprobe zu SSO-only)', async () => {
    setzeSecureContext(true);
    setup(false, [...passwortProvider, ...webauthnProvider], true);
    await screen.findByRole('button', { name: 'Passkey registrieren' });
    expect(await screen.findByRole('button', { name: 'Passwort ändern' })).toBeInTheDocument();
  });

  it('erscheint NICHT, wenn der Passwort-Provider als deaktiviert geliefert wird', async () => {
    setzeSecureContext(true);
    setup(false, [{ ...passwortProvider[0], aktiviert: false }, ...webauthnProvider]);
    // Anker: die Provider-Liste ist geladen.
    await screen.findByRole('button', { name: 'Passkey registrieren' });
    expect(screen.queryByRole('button', { name: 'Passwort ändern' })).toBeNull();
  });

  it('sendet altes und neues Passwort, meldet den Erfolg und schließt den Dialog', async () => {
    setup(false, passwortProvider);
    let body: unknown = null;
    server.use(
      http.post('/api/auth/passwort', async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const dialog = await dialogOeffnen();
    await ausfuellen(dialog, 'startpw12', 'ganzneu1234');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Passwort ändern' }));

    await waitFor(() =>
      expect(body).toEqual({ altes_passwort: 'startpw12', neues_passwort: 'ganzneu1234' }),
    );
    expect(await screen.findByText(/Passwort geändert/)).toBeInTheDocument();
    // antd schließt animiert; „zu" heißt im jsdom: Ausblend-Zustand (`ant-zoom-leave`).
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    // Kein Passwort bleibt im Formularspeicher stehen (Reset auf jedem Weg hinaus, B4).
    expect(within(dialog).getByLabelText('Bisheriges Passwort')).toHaveValue('');
  });

  it('zeigt die Ablehnung im Dialog, nicht als Toast, und lässt die Felder stehen', async () => {
    setup(false, passwortProvider);
    server.use(
      http.post('/api/auth/passwort', () =>
        HttpResponse.json({ error: 'Das bisherige Passwort stimmt nicht.' }, { status: 422 }),
      ),
    );

    const dialog = await dialogOeffnen();
    await ausfuellen(dialog, 'daneben12', 'ganzneu1234');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Passwort ändern' }));

    const meldung = await within(dialog).findByText('Das bisherige Passwort stimmt nicht.');
    expect(meldung.closest('.ant-message')).toBeNull();
    expect(within(dialog).getByLabelText('Bisheriges Passwort')).toHaveValue('daneben12');
  });

  it('sendet nicht, wenn die Wiederholung abweicht', async () => {
    setup(false, passwortProvider);
    const aufruf = vi.fn();
    server.use(
      http.post('/api/auth/passwort', () => {
        aufruf();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const dialog = await dialogOeffnen();
    await ausfuellen(dialog, 'startpw12', 'ganzneu1234', 'ganzneu9999');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Passwort ändern' }));

    expect(
      await within(dialog).findByText('Die Wiederholung weicht vom neuen Passwort ab'),
    ).toBeInTheDocument();
    expect(aufruf).not.toHaveBeenCalled();
  });

  it('sendet nicht, wenn das neue Passwort zu kurz ist', async () => {
    setup(false, passwortProvider);
    const aufruf = vi.fn();
    server.use(
      http.post('/api/auth/passwort', () => {
        aufruf();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const dialog = await dialogOeffnen();
    await ausfuellen(dialog, 'startpw12', 'kurz123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Passwort ändern' }));

    expect(await within(dialog).findByText('Mindestens 8 Zeichen')).toBeInTheDocument();
    expect(aufruf).not.toHaveBeenCalled();
  });
});
