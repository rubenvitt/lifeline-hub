import { Alert, Button, Divider, Form, Input, Space, Tag } from 'antd';
import { KeyOutlined, LoginOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { ApiError } from '../api/client';
import { devBenutzerLaden, type DevBenutzer } from '../api/dev';
import { providerListe } from '../api/auth';
import { totpFinish } from '../api/totp';
import {
  webauthnDiscoverableAnmeldungAbschliessen,
  webauthnDiscoverableAnmeldungStarten,
} from '../api/webauthn';
import type { AuthProvider } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import loginBg from '../assets/login-bg.webp';
import loginBgLight from '../assets/login-bg-light.webp';
import './LoginPage.css';

interface FormWerte {
  benutzername: string;
  passwort: string;
}

interface TotpFormWerte {
  code: string;
}

export default function LoginPage() {
  const { login, aktualisiere } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm<FormWerte>();
  const [totpForm] = Form.useForm<TotpFormWerte>();
  const [fehler, setFehler] = useState<string | null>(null);
  // Welche Aktion gerade läuft — steuert den Spinner GEZIELT (nur der geklickte Button lädt),
  // während `disabled` über das Form weiterhin ALLE Wege sperrt (kein paralleler Doppel-Login).
  const [laedt, setLaedt] = useState<'passwort' | 'passkey' | 'totp' | null>(null);
  const [devBenutzer, setDevBenutzer] = useState<DevBenutzer[]>([]);
  const [provider, setProvider] = useState<AuthProvider[]>([]);
  // Zweite Login-Stufe (LFH-43, TOTP): `login()` meldet „MFA erforderlich" statt eines
  // Benutzers (s. `AuthContext.LoginErgebnis`) → die erste Stufe (Passwort/OIDC/Passkey) weicht
  // einer TOTP-Code-Eingabe. Kein Session-Cookie existiert an dieser Stelle noch.
  const [mfaAktiv, setMfaAktiv] = useState(false);
  // In der TOTP-Stufe: Recovery-Code statt Authenticator-Code eingeben. Beide landen im selben
  // Feld/Endpoint (`totp/finish` unterscheidet serverseitig nicht) — der Umschalter trennt nur
  // die EINGABE-Ergonomie: 6-stellig-numerisch vs. freies Recovery-Format.
  const [recoveryModus, setRecoveryModus] = useState(false);

  const zielPfad = (location.state as { von?: string } | null)?.von ?? '/einsaetze';

  // Nur im Dev-Build: verfügbare Seed-Benutzer laden. Der gesamte Block steht
  // hinter `import.meta.env.DEV` und entfällt im Production-Build per DCE.
  useEffect(() => {
    if (import.meta.env.DEV) {
      devBenutzerLaden()
        .then(setDevBenutzer)
        // Feature aus / Netzwerkfehler → still ignorieren, normales Login bleibt.
        .catch(() => {});
    }
  }, []);

  // Aktive Auth-Provider laden (LFH-57), um das Passwort-Formular bedingt zu rendern.
  useEffect(() => {
    providerListe()
      .then(setProvider)
      // Fehler → Passwort-Login als sicherer Default annehmen.
      .catch(() =>
        setProvider([
          { id: 'passwort', typ: 'passwort', anzeigename: 'Passwort', aktiviert: true },
        ]),
      );
  }, []);

  // provider.length === 0 hält das Formular sichtbar, solange die Liste lädt
  // (kein Flackern, kein Aussperren bei Ladefehler).
  const passwortAktiv =
    provider.length === 0 || provider.some((p) => p.typ === 'passwort' && p.aktiviert);
  // Aktive OIDC-Provider (LFH-41): jeder rendert einen eigenen Redirect-Button.
  const ssoProvider = provider.filter((p) => p.typ === 'oidc' && p.aktiviert);
  // Passkey-Login (LFH-275): nur bei aktivem webauthn-Provider UND Secure Context — WebAuthn
  // verlangt https/localhost, der Button wäre sonst ein Fake-Button (analog OIDC-Precedent).
  const webauthnAktiv = provider.some((p) => p.typ === 'webauthn' && p.aktiviert);
  const passkeyAktiv = webauthnAktiv && window.isSecureContext;
  // Der Passkey-Login ist seit LFH-313 usernameless und braucht das Benutzername-Feld NICHT mehr.
  // Der Formular-Container bleibt sichtbar, sobald Passwort- ODER Passkey-Login aktiv ist — das
  // Benutzername-/Passwort-Feld selbst hängt aber an `passwortAktiv` (s. unten), damit im reinen
  // Passkey-Betrieb kein leeres Benutzername-Feld übrig bleibt.
  const formSichtbar = passwortAktiv || passkeyAktiv;

  // OIDC ist ein Browser-Redirect-Flow (kein fetch/XHR): der Server leitet auf den
  // Identity-Provider weiter, daher ein echter Full-Page-Redirect. `von` trägt das
  // schon berechnete Redirect-Ziel weiter, damit der Callback dorthin zurückführt.
  function starteOidcAnmeldung() {
    window.location.assign(`/api/auth/oidc/start?von=${encodeURIComponent(zielPfad)}`);
  }

  async function absenden(werte: FormWerte) {
    setFehler(null);
    setLaedt('passwort');
    try {
      const ergebnis = await login(werte.benutzername, werte.passwort);
      if (ergebnis.status === 'mfa_erforderlich') {
        setMfaAktiv(true);
        return;
      }
      navigate(zielPfad, { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        // Der Server antwortet bewusst mit dem generischen 401 „Nicht angemeldet" (NO-user-
        // enumeration, s. `password::anmelden`) — für die Anzeige bleibt die Meldung genauso
        // enumeration-sicher, wird aber verständlich formuliert.
        setFehler(e.status === 401 ? 'Benutzername oder Passwort ist falsch' : e.message);
      } else {
        setFehler('Verbindung zum Server fehlgeschlagen');
      }
    } finally {
      setLaedt(null);
    }
  }

  // Zweite Login-Stufe (LFH-43): Body ist ein TOTP- ODER Recovery-Code — dasselbe Feld/
  // Endpoint, `totp/finish` unterscheidet serverseitig nicht zwischen beiden. Anders als beim
  // ersten Schritt (`AuthContext.login` postet die Anmeldedaten und übernimmt den Benutzer
  // selbst) steht die Session hier bereits nach `totp/finish` per Cookie — analog dem
  // Passkey-Pfad muss der Client den Benutzer nur noch per `aktualisiere()` (`/api/auth/me`) in
  // den Context nachladen.
  async function totpAbsenden(werte: TotpFormWerte) {
    setFehler(null);
    setLaedt('totp');
    try {
      await totpFinish(werte.code);
      await aktualisiere();
      navigate(zielPfad, { replace: true });
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Code ungültig');
    } finally {
      setLaedt(null);
    }
  }

  function zurueckZumPasswort() {
    setFehler(null);
    setMfaAktiv(false);
    setRecoveryModus(false);
    totpForm.resetFields();
  }

  function wechsleRecoveryModus() {
    setFehler(null);
    setRecoveryModus((r) => !r);
    totpForm.resetFields(['code']);
  }

  // Passkey-Login (usernameless/discoverable, LFH-313): KEIN Benutzername nötig — der
  // Authenticator entdeckt den Benutzer selbst. discoverable/start → navigator.credentials.get
  // (via `startAuthentication` aus `@simplewebauthn/browser`, leere `allowCredentials` → der
  // Browser zeigt einen Konto-Picker) → discoverable/finish. Anders als beim Passwort-Pfad
  // (`AuthContext.login` postet die Anmeldedaten selbst) steht die Session hier bereits nach
  // `finish` per Cookie — der Client muss den Benutzer nur noch per `aktualisiere()`
  // (`/api/auth/me`) in den Context nachladen.
  async function mitPasskeyAnmelden() {
    setFehler(null);
    setLaedt('passkey');
    try {
      const rcr = await webauthnDiscoverableAnmeldungStarten();
      const cred = await startAuthentication({ optionsJSON: rcr.publicKey });
      await webauthnDiscoverableAnmeldungAbschliessen(cred);
      await aktualisiere();
      navigate(zielPfad, { replace: true });
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Passkey-Anmeldung fehlgeschlagen');
    } finally {
      setLaedt(null);
    }
  }

  return (
    <div
      className="login-seite"
      style={
        {
          '--login-bg': `url(${loginBg})`,
          '--login-bg-light': `url(${loginBgLight})`,
        } as CSSProperties
      }
    >
      <div className="login-karte">
        <div className="login-marke">
          <span className="login-marke__akzent" />
          <h1 className="login-marke__name">lifeline-hub</h1>
          <p className="login-marke__untertitel">Einsatzführung &amp; Einsatztagebuch</p>
        </div>
        {fehler && <Alert type="error" title={fehler} style={{ marginBottom: 20 }} showIcon />}
        {mfaAktiv ? (
          <Form
            layout="vertical"
            form={totpForm}
            onFinish={totpAbsenden}
            disabled={laedt !== null}
            requiredMark={false}
          >
            {recoveryModus ? (
              <Form.Item
                label="Recovery-Code"
                name="code"
                rules={[{ required: true, message: 'Bitte Recovery-Code eingeben' }]}
              >
                <Input
                  size="large"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
                />
              </Form.Item>
            ) : (
              <Form.Item
                label="Code aus deiner Authenticator-App"
                name="code"
                rules={[{ required: true, message: 'Bitte Code eingeben' }]}
              >
                <Input
                  className="login-otp"
                  size="large"
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                />
              </Form.Item>
            )}
            <Button
              className="login-absenden"
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={laedt === 'totp'}
            >
              Anmelden
            </Button>
            <Button type="link" block onClick={wechsleRecoveryModus}>
              {recoveryModus
                ? 'Code aus der Authenticator-App verwenden'
                : 'Recovery-Code verwenden'}
            </Button>
            <Button type="link" block onClick={zurueckZumPasswort}>
              Zurück
            </Button>
          </Form>
        ) : (
          <>
            {/* Dev-Schnellanmeldung: nur im Dev-Build und nur wenn der Endpoint Benutzer lieferte. */}
            {import.meta.env.DEV && devBenutzer.length > 0 && (
              <div className="login-dev">
                <span className="login-dev__titel">Dev-Schnellanmeldung</span>
                <Space wrap size={[8, 8]} className="login-dev__knoepfe">
                  {devBenutzer.map((b) => (
                    <Button
                      key={b.benutzername}
                      size="small"
                      onClick={() =>
                        form.setFieldsValue({
                          benutzername: b.benutzername,
                          passwort: b.passwort,
                        })
                      }
                    >
                      {b.anzeigename}
                      <Tag style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>{b.rolle}</Tag>
                    </Button>
                  ))}
                </Space>
              </div>
            )}
            {ssoProvider.length > 0 && (
              <Space orientation="vertical" style={{ width: '100%' }} size={10}>
                {ssoProvider.map((p) => (
                  <Button
                    key={p.id}
                    size="large"
                    block
                    icon={<LoginOutlined aria-hidden />}
                    onClick={starteOidcAnmeldung}
                  >
                    Mit {p.anzeigename} anmelden
                  </Button>
                ))}
              </Space>
            )}
            {ssoProvider.length > 0 && formSichtbar && <Divider>oder</Divider>}
            {formSichtbar && (
              <Form
                layout="vertical"
                form={form}
                onFinish={absenden}
                disabled={laedt !== null}
                requiredMark={false}
              >
                {passwortAktiv && (
                  <Form.Item
                    label="Benutzername"
                    name="benutzername"
                    rules={[{ required: true, message: 'Bitte Benutzername eingeben' }]}
                  >
                    <Input size="large" autoFocus autoComplete="username" />
                  </Form.Item>
                )}
                {passwortAktiv && (
                  <Form.Item
                    label="Passwort"
                    name="passwort"
                    rules={[{ required: true, message: 'Bitte Passwort eingeben' }]}
                  >
                    <Input.Password size="large" autoComplete="current-password" />
                  </Form.Item>
                )}
                {passwortAktiv && (
                  <Button
                    className="login-absenden"
                    type="primary"
                    htmlType="submit"
                    size="large"
                    block
                    loading={laedt === 'passwort'}
                  >
                    Anmelden
                  </Button>
                )}
                {passkeyAktiv && (
                  <Button
                    size="large"
                    block
                    icon={<KeyOutlined aria-hidden />}
                    style={passwortAktiv ? { marginTop: 12 } : undefined}
                    loading={laedt === 'passkey'}
                    onClick={mitPasskeyAnmelden}
                  >
                    Mit Passkey anmelden
                  </Button>
                )}
              </Form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
