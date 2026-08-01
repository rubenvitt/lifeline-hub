import { Alert, App, Button, Form, Input, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { QRCodeSVG } from 'qrcode.react';
import Platzhalter from '../components/Platzhalter';
import { ApiError } from '../api/client';
import { providerListe } from '../api/auth';
import { enrollFinish, enrollStart } from '../api/totp';
import { webauthnRegistrierungAbschliessen, webauthnRegistrierungStarten } from '../api/webauthn';
import type { AuthProvider } from '../api/types';
import { useAuth } from '../auth/AuthContext';

interface TotpCodeWerte {
  code: string;
}

/** Laufendes TOTP-Enrollment (LFH-43): das Secret ist bereits serverseitig gespeichert, aber
 *  NOCH NICHT aktiv (`totp_aktiviert = 0`) — erst ein bestätigender Code in `enrollFinish`
 *  schaltet MFA scharf (s. `enrollStart`-Doc in `api/totp.ts`). */
interface TotpEnrollment {
  otpauthUrl: string;
  secretBase32: string;
}

export default function ProfilPage() {
  const { benutzer, aktualisiere } = useAuth();
  // Kein vierter Alert-Zustand neben `fehler`/`erfolg`/`totpFehler`: das Kopieren ist eine
  // flüchtige Aktion ohne Folgezustand, die drei Alerts tragen Zustände. `App.useApp()`
  // hat im Repo breite Präzedenz, `<AntApp>` steht in main.tsx und in test/utils.tsx.
  const { message } = App.useApp();
  const [provider, setProvider] = useState<AuthProvider[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState(false);
  const [laedt, setLaedt] = useState(false);

  // TOTP-Enroll (LFH-43, Increment 5, Task 7).
  const [totpForm] = Form.useForm<TotpCodeWerte>();
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(null);
  const [totpFehler, setTotpFehler] = useState<string | null>(null);
  const [totpLaedt, setTotpLaedt] = useState(false);
  // Die Recovery-Codes werden vom Server NUR EINMALIG (bei `enrollFinish`) zurückgegeben —
  // lokaler State, UNABHÄNGIG vom `totp_aktiviert`-Status im Context: sobald `aktualisiere()`
  // danach den Status auf „aktiv" dreht, darf die Box mit den Codes nicht verschwinden (sie ist
  // die einzige Chance, sie zu sichern).
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Aktive Auth-Provider laden (wie LoginPage), um die Passkey-Sektion bedingt zu rendern.
  useEffect(() => {
    providerListe()
      .then(setProvider)
      // Fehler/Netzwerkproblem → Passkey-Sektion bleibt einfach ausgeblendet, kein Fake-Button.
      .catch(() => setProvider([]));
  }, []);

  const webauthnAktiv = provider.some((p) => p.typ === 'webauthn' && p.aktiviert);
  // WebAuthn selbst verlangt einen Secure Context (https/localhost) — ohne den würde
  // `navigator.credentials.create` serverseitig scheitern, bevor überhaupt eine Ceremony
  // beginnt. Der Button erscheint also nur, wenn er auch tatsächlich funktionieren kann.
  const passkeySichtbar = window.isSecureContext && webauthnAktiv;
  // Dieselbe Frage für die Zwischenablage, aus demselben Grund: `navigator.clipboard` ist
  // ein Secure-Context-Feature und im Nicht-Secure-Context gar nicht erst vorhanden — die
  // Zeile darüber belegt, dass diese App dort läuft. Die Fähigkeit wird gefragt, nicht
  // geraten; ein Knopf, der nichts tut, ist schlimmer als kein Knopf.
  const kopierenMoeglich = typeof navigator.clipboard?.writeText === 'function';

  async function passkeyRegistrieren() {
    setFehler(null);
    setErfolg(false);
    setLaedt(true);
    try {
      const ccr = await webauthnRegistrierungStarten();
      const cred = await startRegistration({ optionsJSON: ccr.publicKey });
      await webauthnRegistrierungAbschliessen(cred);
      setErfolg(true);
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Passkey-Registrierung fehlgeschlagen');
    } finally {
      setLaedt(false);
    }
  }

  // TOTP-Enroll (LFH-43): startet ein Enrollment. Ein erneuter Klick (Re-Enroll, z.B. neues
  // Gerät) überschreibt serverseitig das noch nicht bestätigte Secret — s. `enrollStart`-Doc.
  async function totpEinrichtenStarten() {
    setTotpFehler(null);
    setTotpLaedt(true);
    try {
      const start = await enrollStart();
      setTotpEnrollment({ otpauthUrl: start.otpauth_url, secretBase32: start.secret_base32 });
    } catch (e) {
      setTotpFehler(e instanceof ApiError ? e.message : 'TOTP-Einrichtung fehlgeschlagen');
    } finally {
      setTotpLaedt(false);
    }
  }

  async function totpBestaetigen(werte: TotpCodeWerte) {
    setTotpFehler(null);
    setTotpLaedt(true);
    try {
      const antwort = await enrollFinish(werte.code);
      setRecoveryCodes(antwort.recovery_codes);
      setTotpEnrollment(null);
      totpForm.resetFields();
      await aktualisiere();
    } catch (e) {
      setTotpFehler(e instanceof ApiError ? e.message : 'Code ungültig');
    } finally {
      setTotpLaedt(false);
    }
  }

  function recoveryCodesKopieren() {
    if (!recoveryCodes) return;
    // BEIDE Ausgänge melden sich. Vorher stand hier `navigator.clipboard?.writeText(...)
    // .catch(() => {})`: im Nicht-Secure-Context kurzschloss das `?.` die ganze Kette, und
    // im Erfolgsfall sagte ohnehin nichts etwas — der einzige Ein-Klick-Weg zu Codes, die
    // nur EINMAL angezeigt werden, war ein stiller No-Op.
    // Zwei Zweige, nicht einer: `writeText` kann vorhanden sein und trotzdem ablehnen
    // (NotAllowedError, fehlende Berechtigung). Das `?.` fällt weg, weil der Aufrufer die
    // Fähigkeit über `kopierenMoeglich` bereits geprüft hat.
    navigator.clipboard.writeText(recoveryCodes.join('\n')).then(
      () => message.success('Recovery-Codes kopiert'),
      () =>
        message.error(
          'Kopieren fehlgeschlagen — die Codes oben lassen sich markieren und kopieren',
        ),
    );
  }

  const totpAktiv = benutzer?.totp_aktiviert ?? false;

  return (
    <div>
      {passkeySichtbar && (
        <div style={{ maxWidth: 480, marginBottom: 32 }}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Passkey
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            Registriere einen Passkey für passwortlose Anmeldung auf diesem Gerät.
          </Typography.Paragraph>
          {fehler && <Alert type="error" title={fehler} showIcon style={{ marginBottom: 12 }} />}
          {erfolg && (
            <Alert
              type="success"
              title="Passkey registriert"
              showIcon
              style={{ marginBottom: 12 }}
            />
          )}
          <Button onClick={passkeyRegistrieren} loading={laedt}>
            Passkey registrieren
          </Button>
        </div>
      )}

      <div style={{ maxWidth: 480, marginBottom: 32 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Zwei-Faktor (TOTP)
        </Typography.Title>

        {recoveryCodes && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Recovery-Codes jetzt sichern"
            description={
              <div>
                <Typography.Paragraph style={{ marginBottom: 8 }}>
                  Diese Codes werden nur einmal angezeigt und sind der einzige Ausweg bei
                  Geräteverlust (Authenticator-App weg/gelöscht). Jeder Code ist genau einmal
                  verwendbar.
                </Typography.Paragraph>
                <pre
                  style={{
                    background: 'rgba(0,0,0,0.04)',
                    padding: 12,
                    borderRadius: 4,
                    marginBottom: 8,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {recoveryCodes.join('\n')}
                </pre>
                {/* `block` statt Klein-Angabe: das ist der einzige Ein-Klick-Weg zu Codes,
                    die nur einmal angezeigt werden. Ohne Zwischenablage KEIN toter Knopf,
                    sondern der ehrliche Hinweis auf das `<pre>` darüber — die Codes sind
                    markierbar, ein zweiter Mechanismus wäre überflüssig. Bewusst ohne
                    „Strg+C": das Führungs-Tablet hat keine Strg-Taste. */}
                {kopierenMoeglich ? (
                  <Button block onClick={recoveryCodesKopieren}>
                    Codes kopieren
                  </Button>
                ) : (
                  <Typography.Text type="secondary">
                    Kopieren ist auf dieser Verbindung nicht möglich — die Codes oben lassen
                    sich markieren und kopieren.
                  </Typography.Text>
                )}
              </div>
            }
          />
        )}

        {totpFehler && (
          <Alert type="error" title={totpFehler} showIcon style={{ marginBottom: 12 }} />
        )}

        {totpAktiv ? (
          <>
            <Alert type="success" title="2FA aktiv" showIcon style={{ marginBottom: 8 }} />
            <Typography.Paragraph type="secondary">
              Deaktivieren ist aktuell nur über einen Admin-Reset möglich (self-service
              Deaktivieren ist bewusst nicht vorgesehen).
            </Typography.Paragraph>
          </>
        ) : totpEnrollment ? (
          <div>
            <Typography.Paragraph type="secondary">
              QR-Code mit deiner Authenticator-App scannen (oder das Secret manuell eintragen)
              und den generierten Code bestätigen.
            </Typography.Paragraph>
            <div
              style={{
                background: '#fff',
                padding: 12,
                width: 'fit-content',
                marginBottom: 12,
              }}
            >
              <QRCodeSVG value={totpEnrollment.otpauthUrl} size={176} />
            </div>
            <Typography.Paragraph copyable={{ text: totpEnrollment.secretBase32 }}>
              Secret (manuelle Eingabe): <code>{totpEnrollment.secretBase32}</code>
            </Typography.Paragraph>
            <Form
              layout="vertical"
              form={totpForm}
              onFinish={totpBestaetigen}
              disabled={totpLaedt}
              requiredMark={false}
            >
              <Form.Item
                label="Code aus deiner Authenticator-App"
                name="code"
                rules={[{ required: true, message: 'Bitte Code eingeben' }]}
              >
                <Input size="large" autoFocus autoComplete="one-time-code" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={totpLaedt}>
                Bestätigen
              </Button>
            </Form>
          </div>
        ) : (
          <>
            <Typography.Paragraph type="secondary">
              Sichere dein Konto mit einem zweiten Faktor aus einer Authenticator-App ab.
            </Typography.Paragraph>
            <Button onClick={totpEinrichtenStarten} loading={totpLaedt}>
              2FA einrichten
            </Button>
          </>
        )}
      </div>

      <Platzhalter
        titel="Profil"
        beschreibung="Eigener Account und app-weite Einstellungen."
      />
    </div>
  );
}
