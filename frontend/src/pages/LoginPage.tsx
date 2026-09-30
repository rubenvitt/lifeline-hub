import { Alert, Button, Divider, Form, Input, Space, Tag } from 'antd';
import { KeyOutlined, LoginOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { startAuthentication } from '@simplewebauthn/browser';
import { ApiError, fehlerText } from '../api/client';
import OtpEingabe from '../components/OtpEingabe';
import { devBenutzerLaden, type DevBenutzer } from '../api/dev';
import { providerListe } from '../api/auth';
import { totpFinish } from '../api/totp';
import {
  webauthnDiscoverableAnmeldungAbschliessen,
  webauthnDiscoverableAnmeldungStarten,
} from '../api/webauthn';
import type { AuthProvider } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { huelleSperrtPasskey } from '../huelle/faehigkeiten';
import './LoginPage.css';

interface FormWerte {
  benutzername: string;
  passwort: string;
}

interface TotpFormWerte {
  code: string;
}

export default function LoginPage() {
  const { login, aktualisiere, benutzer, laedt: authLaedt } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm<FormWerte>();
  const [totpForm] = Form.useForm<TotpFormWerte>();
  // Der OIDC-Callback leitet jeden Fehlschlag generisch auf `/login?fehler=oidc` (bewusst ohne
  // IdP-Detail) — ohne diese Auswertung sähe ein gescheiterter SSO-Login aus, als wäre nichts
  // passiert.
  const [fehler, setFehler] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('fehler') === 'oidc'
      ? 'Die Anmeldung über Single Sign-On ist fehlgeschlagen'
      : null,
  );
  // Welche Aktion gerade läuft — steuert den Spinner gezielt (nur der geklickte Knopf lädt),
  // während `disabled` über das Form alle Wege sperrt (kein paralleler Doppel-Login).
  const [laedt, setLaedt] = useState<'passwort' | 'passkey' | 'totp' | null>(null);
  /** Riegel gegen zwei gleichzeitige `totp/finish` — s. `totpAbsenden`. */
  const sendetRef = useRef(false);
  const [devBenutzer, setDevBenutzer] = useState<DevBenutzer[]>([]);
  const [provider, setProvider] = useState<AuthProvider[]>([]);
  // Zweite Login-Stufe (TOTP): `login()` meldet „MFA erforderlich" statt eines Benutzers (s.
  // `AuthContext.LoginErgebnis`) → die erste Stufe weicht einer Code-Eingabe. Ein Session-Cookie
  // gibt es an dieser Stelle noch nicht.
  const [mfaAktiv, setMfaAktiv] = useState(false);
  // In der TOTP-Stufe: Recovery-Code statt Authenticator-Code. Beide landen im selben Endpoint
  // (`totp/finish` unterscheidet nicht); der Umschalter trennt nur die Eingabe-Ergonomie
  // (6-stellig-numerisch vs. freies Recovery-Format).
  const [recoveryModus, setRecoveryModus] = useState(false);

  const zielPfad = (location.state as { von?: string } | null)?.von ?? '/einsaetze';

  // Anmeldung aus einem anderen Tab (LFH-387): der AuthProvider übernimmt sie, die Seite zieht
  // nach. Nur beim Übergang „anonym → angemeldet“ — wer angemeldet `/login` aufruft, um den
  // Benutzer zu wechseln, bleibt hier. Der eigene Login navigiert ohnehin selbst dorthin.
  const anonymGesehen = useRef(false);
  useEffect(() => {
    if (authLaedt) return;
    if (benutzer === null) {
      anonymGesehen.current = true;
    } else if (anonymGesehen.current) {
      anonymGesehen.current = false;
      navigate(zielPfad, { replace: true });
    }
  }, [authLaedt, benutzer, navigate, zielPfad]);

  // Nur im Dev-Build: verfügbare Seed-Benutzer laden. Der Block steht hinter `import.meta.env.DEV`
  // und entfällt im Production-Build per DCE.
  useEffect(() => {
    if (import.meta.env.DEV) {
      devBenutzerLaden()
        .then(setDevBenutzer)
        // Feature aus / Netzwerkfehler → still ignorieren, normales Login bleibt.
        .catch(() => {});
    }
  }, []);

  // Aktive Auth-Provider laden, um das Passwort-Formular bedingt zu rendern.
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

  // provider.length === 0 hält das Formular sichtbar, solange die Liste lädt (kein Flackern, kein
  // Aussperren bei Ladefehler).
  const passwortAktiv =
    provider.length === 0 || provider.some((p) => p.typ === 'passwort' && p.aktiviert);
  // Aktive OIDC-Provider: jeder rendert einen eigenen Redirect-Knopf.
  const ssoProvider = provider.filter((p) => p.typ === 'oidc' && p.aktiviert);
  // Passkey-Login nur bei aktivem webauthn-Provider und Secure Context — WebAuthn verlangt
  // https/localhost, der Knopf wäre sonst ohne Funktion.
  // In der macOS-Hülle scheitert jeder Passkey, die Hülle sagt es selbst (LFH-817).
  const webauthnAktiv = provider.some((p) => p.typ === 'webauthn' && p.aktiviert);
  const passkeyGesperrt = huelleSperrtPasskey();
  const passkeyAktiv = webauthnAktiv && window.isSecureContext && !passkeyGesperrt;
  // Der Passkey-Login ist usernameless. Der Formular-Container bleibt sichtbar, sobald Passwort-
  // oder Passkey-Login aktiv ist; die Benutzername-/Passwort-Felder hängen an `passwortAktiv`,
  // damit im reinen Passkey-Betrieb kein leeres Feld übrig bleibt.
  const formSichtbar = passwortAktiv || passkeyAktiv;

  // OIDC ist ein Browser-Redirect-Flow (kein fetch/XHR), daher ein echter Full-Page-Redirect. `von`
  // trägt das Redirect-Ziel weiter, damit der Callback dorthin zurückführt.
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
        // Der Server antwortet bewusst mit dem generischen 401 (keine User-Enumeration, s.
        // `password::anmelden`) — die Anzeige bleibt ebenso enumeration-sicher, nur verständlich
        // formuliert.
        setFehler(e.status === 401 ? 'Benutzername oder Passwort ist falsch' : e.message);
      } else {
        setFehler('Verbindung zum Server fehlgeschlagen');
      }
    } finally {
      setLaedt(null);
    }
  }

  // Zweite Login-Stufe: der Body ist ein TOTP- oder Recovery-Code, `totp/finish` unterscheidet
  // nicht. Anders als `AuthContext.login` steht die Session hier bereits nach `totp/finish` per
  // Cookie — der Client lädt den Benutzer nur per `aktualisiere()` (`/api/auth/me`) nach.
  async function totpAbsenden(werte: TotpFormWerte) {
    // Doppelabsende-Riegel: die sechste Ziffer sendet selbst ab, der Knopf bleibt als Rückfallweg —
    // zwei Wege zu diesem Aufruf. Wer die letzte Ziffer tippt und sofort „Anmelden" drückt, löste
    // sonst zwei `totp/finish` aus; der zweite scheitert, weil ein TOTP-Code genau einmal gültig
    // ist, und meldete „Code ungültig". Der Riegel steht hier und nicht am Knopf: die Eingabetaste
    // erreicht einen `loading`-Knopf gar nicht erst (wie `sendetRef` in
    // `components/Erfassung.tsx`).
    if (sendetRef.current) return;
    sendetRef.current = true;
    setFehler(null);
    setLaedt('totp');
    try {
      await totpFinish(werte.code);
      await aktualisiere();
      navigate(zielPfad, { replace: true });
    } catch (e) {
      setFehler(fehlerText(e, 'Code ungültig'));
    } finally {
      // Der Riegel fällt im finally: nach einer Ablehnung muss der nächste Versuch sofort möglich
      // sein.
      sendetRef.current = false;
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

  // Passkey-Login (usernameless/discoverable): der Authenticator entdeckt den Benutzer selbst.
  // discoverable/start → navigator.credentials.get (`startAuthentication`, leere `allowCredentials`
  // → Konto-Picker) → discoverable/finish. Die Session steht nach `finish` per Cookie; der Client
  // lädt den Benutzer per `aktualisiere()` nach.
  //
  // Tradeoff: der Konto-Picker bietet nur discoverable/resident Credentials an. Passkeys auf
  // Authenticatoren, die non-resident anlegen (manche Roaming-Keys; die Registrierung nutzt
  // `require_resident_key(false)`), erscheinen hier nicht. Auf Platform-Authenticatoren (Touch
  // ID/iCloud, Windows Hello) sind Passkeys immer discoverable. Der benutzergebundene Weg
  // (`/auth/{start,finish}`) bleibt im Backend, das Frontend bietet ihn nicht an.
  // Resident-Key-Zwang bei der Registrierung: LFH-277.
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
      setFehler(fehlerText(e, 'Passkey-Anmeldung fehlgeschlagen'));
    } finally {
      setLaedt(null);
    }
  }

  return (
    <div className="login-seite">
      <div className="login-karte">
        <div className="login-marke">
          <div className="login-marke__zeile">
            <span className="login-marke__quadrat" aria-hidden="true" />
            <h1 className="login-marke__name">lifeline-hub</h1>
          </div>
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
                {/* Das geteilte OTP-Primitiv (auch auf der Profilseite). Sechs Ziffern senden
                    ab, der Knopf darunter bleibt der Rückfallweg. */}
                <OtpEingabe autoFocus onVoll={() => totpForm.submit()} />
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
            {/* Dev-Schnellanmeldung: nur im Dev-Build und nur, wenn der Endpoint Benutzer
                lieferte. */}
            {import.meta.env.DEV && devBenutzer.length > 0 && (
              <div className="login-dev">
                <span className="login-dev__titel">Dev-Schnellanmeldung</span>
                <Space wrap size={[8, 8]} className="login-dev__knoepfe">
                  {devBenutzer.map((b) => (
                    <Button
                      key={b.benutzername}
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
            {/* Nur Passkey aktiv, und die Hülle kann ihn nicht: ohne diesen Satz bliebe die Karte
                leer (LFH-817). Bleibt Passwort oder OIDC, fehlt der Passkey still. */}
            {passkeyGesperrt && webauthnAktiv && !formSichtbar && ssoProvider.length === 0 && (
              <Alert
                type="info"
                showIcon
                title="Die Anmeldung per Passkey geht in der Mac-App nicht. Melde dich im Browser an."
              />
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
