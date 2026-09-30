import { Alert, App, Button, Form, Typography } from 'antd';
import AdminPage from '../components/AdminPage';
import {
  Augenbraue,
  Datenfeld,
  Datenraster,
  Paneel,
  monoStil,
  useRollen,
} from '../components/instrument';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { startRegistration } from '@simplewebauthn/browser';
import { QRCodeSVG } from 'qrcode.react';
import OtpEingabe from '../components/OtpEingabe';
import { fehlerText } from '../api/client';
import { providerListe } from '../api/auth';
import { ladeOrganisation } from '../api/organisation';
import { globalKeys } from '../api/queryKeys';
import { enrollFinish, enrollStart } from '../api/totp';
import { webauthnRegistrierungAbschliessen, webauthnRegistrierungStarten } from '../api/webauthn';
import type { AuthProvider } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import PasswortAendernDialog from '../auth/PasswortAendernDialog';
import { huelleSperrtPasskey } from '../huelle/faehigkeiten';

interface TotpCodeWerte {
  code: string;
}

/**
 * Rollen-Beschriftung als Wort statt als Wire-Wert. Die Schreibweise folgt `pages/BenutzerPage.tsx`
 * („Admin" / „Führungskraft" / „Benutzer"), damit dieselbe Rolle nicht zwei Namen trägt. Bewusst
 * keine geteilte Map: ihr Platz wäre `theme`/`auth`; wer die dritte Stelle baut, zieht sie dorthin.
 */
function rollenText(benutzer: { system_rolle: string; org_rolle: string } | null): string {
  if (!benutzer) return '—';
  if (benutzer.system_rolle === 'admin') return 'Admin';
  if (benutzer.org_rolle === 'fuehrungskraft') return 'Führungskraft';
  return 'Benutzer';
}

/**
 * Laufendes TOTP-Enrollment: das Secret ist serverseitig gespeichert, aber noch nicht aktiv
 * (`totp_aktiviert = 0`) — erst ein bestätigender Code in `enrollFinish` schaltet MFA scharf (s.
 * `enrollStart` in `api/totp.ts`).
 */
interface TotpEnrollment {
  otpauthUrl: string;
  secretBase32: string;
}

export default function ProfilPage() {
  const { benutzer, aktualisiere } = useAuth();
  // Kein vierter Alert-Zustand neben `fehler`/`erfolg`/`totpFehler`: das Kopieren ist eine
  // flüchtige Aktion ohne Folgezustand. `<AntApp>` steht in main.tsx und test/utils.tsx.
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const [provider, setProvider] = useState<AuthProvider[]>([]);
  // Die Organisation steht nicht an `BenutzerAnzeige` — eigener Abruf. Nicht-blockierend und ohne
  // Fehlerzweig: schlägt er fehl, zeigt die Kopfsektion „—", die Sicherheits-Abschnitte bleiben
  // bedienbar.
  const { data: organisation } = useQuery({
    queryKey: globalKeys.organisation(),
    queryFn: ladeOrganisation,
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState(false);
  const [laedt, setLaedt] = useState(false);

  // TOTP-Enroll.
  const [totpForm] = Form.useForm<TotpCodeWerte>();
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(null);
  const [totpFehler, setTotpFehler] = useState<string | null>(null);
  const [totpLaedt, setTotpLaedt] = useState(false);
  /** Riegel gegen zwei gleichzeitige `enrollFinish` — s. `totpBestaetigen`. */
  const sendetRef = useRef(false);
  // Die Recovery-Codes gibt der Server nur einmal zurück (bei `enrollFinish`) — lokaler State,
  // unabhängig von `totp_aktiviert`: dreht `aktualisiere()` den Status auf „aktiv", darf die Box
  // nicht verschwinden (einzige Chance, die Codes zu sichern).
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const [passwortDialogOffen, setPasswortDialogOffen] = useState(false);

  // Aktive Auth-Provider laden (wie LoginPage), um die Passkey- und Passwort-Sektion bedingt zu
  // rendern.
  useEffect(() => {
    providerListe()
      .then(setProvider)
      // Fehler/Netzwerkproblem → Passkey- und Passwort-Sektion bleiben ausgeblendet.
      .catch(() => setProvider([]));
  }, []);

  const webauthnAktiv = provider.some((p) => p.typ === 'webauthn' && p.aktiviert);
  // Ohne Passwort-Anmeldung kein Passwortwechsel (LFH-471); der Server lehnt ihn dann ohnehin mit
  // 403 ab. Anders als die LoginPage kein Rückfall auf „aktiv" bei leerer Liste: dort sperrte er
  // sonst jeden aus, hier bliebe nur ein Knopf, der nicht wirken kann.
  const passwortAktiv = provider.some((p) => p.typ === 'passwort' && p.aktiviert);
  // WebAuthn verlangt einen Secure Context (https/localhost); ohne ihn scheiterte
  // `navigator.credentials.create`, bevor eine Ceremony beginnt. Der Knopf erscheint nur, wenn er
  // funktionieren kann.
  const passkeyMoeglich = window.isSecureContext && webauthnAktiv;
  // Die macOS-Hülle kann keinen Passkey ausführen und sagt es selbst (LFH-817): statt der
  // Einrichtung steht dort ein Satz, wo es geht.
  const passkeyGesperrt = passkeyMoeglich && huelleSperrtPasskey();
  const passkeySichtbar = passkeyMoeglich && !passkeyGesperrt;
  // Dieselbe Frage für die Zwischenablage: `navigator.clipboard` ist ein Secure-Context-Feature und
  // dort sonst gar nicht vorhanden. Die Fähigkeit wird gefragt, nicht geraten; ein Knopf, der
  // nichts tut, ist schlimmer als keiner.
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
      setFehler(fehlerText(e, 'Passkey-Registrierung fehlgeschlagen'));
    } finally {
      setLaedt(false);
    }
  }

  // Startet ein TOTP-Enrollment. Ein erneuter Klick (Re-Enroll, z. B. neues Gerät) überschreibt
  // serverseitig das noch nicht bestätigte Secret.
  async function totpEinrichtenStarten() {
    setTotpFehler(null);
    setTotpLaedt(true);
    try {
      const start = await enrollStart();
      setTotpEnrollment({ otpauthUrl: start.otpauth_url, secretBase32: start.secret_base32 });
    } catch (e) {
      setTotpFehler(fehlerText(e, 'TOTP-Einrichtung fehlgeschlagen'));
    } finally {
      setTotpLaedt(false);
    }
  }

  async function totpBestaetigen(werte: TotpCodeWerte) {
    // Doppelabsende-Riegel wie in `LoginPage`: die sechste Ziffer sendet selbst ab, zwei Wege
    // führen hierher, und ein TOTP-Code ist serverseitig genau einmal gültig — der zweite Aufruf
    // meldete einen Fehler für einen Code, der gerade funktioniert hat.
    if (sendetRef.current) return;
    sendetRef.current = true;
    setTotpFehler(null);
    setTotpLaedt(true);
    try {
      const antwort = await enrollFinish(werte.code);
      setRecoveryCodes(antwort.recovery_codes);
      setTotpEnrollment(null);
      totpForm.resetFields();
      await aktualisiere();
    } catch (e) {
      setTotpFehler(fehlerText(e, 'Code ungültig'));
    } finally {
      // Fällt im finally: nach einer Ablehnung muss der nächste Versuch sofort gehen.
      sendetRef.current = false;
      setTotpLaedt(false);
    }
  }

  function recoveryCodesKopieren() {
    if (!recoveryCodes) return;
    // Beide Ausgänge melden sich — der einzige Ein-Klick-Weg zu Codes, die nur einmal angezeigt
    // werden, darf kein stiller No-Op sein. Zwei Zweige: `writeText` kann vorhanden sein und
    // trotzdem ablehnen (NotAllowedError, fehlende Berechtigung). Kein `?.`, weil der Aufrufer die
    // Fähigkeit über `kopierenMoeglich` geprüft hat.
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
    // Reine Formularseite: ausdrücklich schmal.
    <AdminPage titel="Profil" breite="schmal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
        <Paneel titel="Konto">
          {/* Die Organisation kommt aus einem eigenen Abruf; fällt der aus, bleibt „—".
              Benutzername in Mono: er ist eine Kennung, kein Name. */}
          <Datenraster spalten={2} beschriftung="Kontodaten" style={{ border: 0 }}>
            <Datenfeld label="Anzeigename">{benutzer?.anzeigename ?? '—'}</Datenfeld>
            <Datenfeld label="Benutzername" mono>
              {benutzer?.benutzername ?? '—'}
            </Datenfeld>
            <Datenfeld label="Systemrolle">{rollenText(benutzer)}</Datenfeld>
            <Datenfeld label="Organisation">{organisation?.name ?? '—'}</Datenfeld>
          </Datenraster>
        </Paneel>

        <Paneel titel="Sicherheit" koerperPolster>
          <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginLG }}>
            {passwortAktiv && (
              <section style={{ maxWidth: 480 }}>
                <Augenbraue als="h3" style={{ marginBottom: token.marginXS }}>
                  Passwort
                </Augenbraue>
                <Typography.Paragraph type="secondary">
                  Ändere dein Passwort mit Angabe des bisherigen. Diese Sitzung bleibt angemeldet,
                  alle anderen Anmeldungen deines Kontos werden beendet.
                </Typography.Paragraph>
                <Button onClick={() => setPasswortDialogOffen(true)}>Passwort ändern</Button>
                <PasswortAendernDialog
                  offen={passwortDialogOffen}
                  onSchliessen={() => setPasswortDialogOffen(false)}
                />
              </section>
            )}

            {passkeyGesperrt && (
              <section style={{ maxWidth: 480 }}>
                <Augenbraue als="h3" style={{ marginBottom: token.marginXS }}>
                  Passkey
                </Augenbraue>
                {/* Nicht versprechen, dass ein im Browser eingerichteter Passkey danach in der
                    Mac-App trägt: das kommt erst mit der Anmeldung im Systembrowser (LFH-818). */}
                <Typography.Paragraph type="secondary">
                  Passkeys richtest du im Browser ein und meldest dich dort damit an, in der Mac-App
                  gehen sie nicht.
                </Typography.Paragraph>
              </section>
            )}

            {passkeySichtbar && (
              <section style={{ maxWidth: 480 }}>
                <Augenbraue als="h3" style={{ marginBottom: token.marginXS }}>
                  Passkey
                </Augenbraue>
                <Typography.Paragraph type="secondary">
                  Registriere einen Passkey für passwortlose Anmeldung auf diesem Gerät.
                </Typography.Paragraph>
                {fehler && (
                  <Alert type="error" title={fehler} showIcon style={{ marginBottom: 12 }} />
                )}
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
              </section>
            )}

            <section style={{ maxWidth: 480 }}>
              <Augenbraue als="h3" style={{ marginBottom: token.marginXS }}>
                Zwei-Faktor (TOTP)
              </Augenbraue>

              {recoveryCodes && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  // `title` statt des in antd 6 abgelösten `message`.
                  title="Recovery-Codes jetzt sichern"
                  description={
                    <div>
                      <Typography.Paragraph style={{ marginBottom: 8 }}>
                        Diese Codes werden nur einmal angezeigt und sind der einzige Ausweg bei
                        Geräteverlust (Authenticator-App weg/gelöscht). Jeder Code ist genau einmal
                        verwendbar.
                      </Typography.Paragraph>
                      <pre
                        style={{
                          background: rollen.flaeche2,
                          padding: 12,
                          borderRadius: 0,
                          ...monoStil(13),
                          marginBottom: 8,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {recoveryCodes.join('\n')}
                      </pre>
                      {/* `block` statt Klein-Angabe: der einzige Ein-Klick-Weg zu Codes, die
                          nur einmal angezeigt werden. Ohne Zwischenablage kein toter Knopf,
                          sondern der Hinweis auf das markierbare `<pre>` darüber. Bewusst ohne
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
                      // Ein QR-Code braucht hellen Grund, auch im Nachtbetrieb — Scanner lesen
                      // dunkle Module auf hellem Feld. Grund und Ruhezone (4 Module, `marginSize`)
                      // trägt das SVG selbst (`bgColor`-Vorgabe der Bibliothek); die Hülle nimmt
                      // nur die Modus-Rolle.
                      background: rollen.flaeche,
                      width: 'fit-content',
                      marginBottom: token.marginSM,
                    }}
                  >
                    <QRCodeSVG value={totpEnrollment.otpauthUrl} size={200} marginSize={4} />
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
                      {/* Dasselbe Primitiv wie auf der Anmeldeseite (Ziffern-Tastatur,
                          Längengrenze, Ziffern-Optik). */}
                      <OtpEingabe autoFocus onVoll={() => totpForm.submit()} />
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
            </section>
          </div>
        </Paneel>
      </div>
    </AdminPage>
  );
}
