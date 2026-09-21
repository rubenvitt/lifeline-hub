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
import { farbenHell, flaeche } from '../theme/tokens';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { startRegistration } from '@simplewebauthn/browser';
import { QRCodeSVG } from 'qrcode.react';
import OtpEingabe from '../components/OtpEingabe';
import { ApiError } from '../api/client';
import { providerListe } from '../api/auth';
import { ladeOrganisation } from '../api/organisation';
import { globalKeys } from '../api/queryKeys';
import { enrollFinish, enrollStart } from '../api/totp';
import { webauthnRegistrierungAbschliessen, webauthnRegistrierungStarten } from '../api/webauthn';
import type { AuthProvider } from '../api/types';
import { useAuth } from '../auth/AuthContext';

interface TotpCodeWerte {
  code: string;
}

/**
 * Rollen-Beschriftung als WORT statt als Wire-Wert (LFH-345 · C10, N5).
 *
 * Die Schreibweise folgt den Etiketten in `pages/BenutzerPage.tsx` („Admin" /
 * „Führungskraft" / „Benutzer") — dieselbe Rolle darf nicht an zwei Stellen zwei Namen
 * tragen. Bewusst KEINE geteilte Map: die gäbe es dann an drei Orten (hier, BenutzerPage,
 * `auth/`), und ihr richtiger Platz wäre `theme`/`auth`, nicht diese Seite. Wer die dritte
 * Stelle baut, zieht sie hoch.
 */
function rollenText(benutzer: { system_rolle: string; org_rolle: string } | null): string {
  if (!benutzer) return '—';
  if (benutzer.system_rolle === 'admin') return 'Admin';
  if (benutzer.org_rolle === 'fuehrungskraft') return 'Führungskraft';
  return 'Benutzer';
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
  const { token, rollen } = useRollen();
  const [provider, setProvider] = useState<AuthProvider[]>([]);
  // Die Organisation steht nicht an `BenutzerAnzeige` — sie kommt aus einem eigenen Abruf.
  // Nicht-blockierend und ohne Fehlerzweig: schlägt er fehl, zeigt die Kopfsektion „—",
  // und die beiden Sicherheits-Abschnitte darunter bleiben unberührt bedienbar.
  const { data: organisation } = useQuery({
    queryKey: globalKeys.organisation(),
    queryFn: ladeOrganisation,
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState(false);
  const [laedt, setLaedt] = useState(false);

  // TOTP-Enroll (LFH-43, Increment 5, Task 7).
  const [totpForm] = Form.useForm<TotpCodeWerte>();
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(null);
  const [totpFehler, setTotpFehler] = useState<string | null>(null);
  const [totpLaedt, setTotpLaedt] = useState(false);
  /** Riegel gegen zwei gleichzeitige `enrollFinish` — s. `totpBestaetigen`. */
  const sendetRef = useRef(false);
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
    // Doppelabsende-Riegel (LFH-345 · C10, M20) — dieselbe Begründung wie in `LoginPage`:
    // seit die sechste Ziffer selbst absendet, führen zwei Wege hierher, und ein TOTP-Code
    // ist serverseitig genau einmal gültig. Der zweite Aufruf verbrauchte kein Recht,
    // sondern erzeugte eine Fehlermeldung für einen Code, der gerade funktioniert hat.
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
      setTotpFehler(e instanceof ApiError ? e.message : 'Code ungültig');
    } finally {
      // Fällt im finally: nach einer Ablehnung muss der nächste Versuch sofort gehen.
      sendetRef.current = false;
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
    // Reine Formularseite: ausdrücklich schmal, unabhängig von der Vorgabe des Primitivs.
    <AdminPage titel="Profil" breite={flaeche.seiteSchmal}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
        <Paneel titel="Konto">
          {/* Die Organisation steht nicht am Benutzer, sie kommt aus einem eigenen Abruf.
              Fällt der aus, bleibt „—" — die Kopfsektion ist deshalb nicht weniger
              brauchbar. Benutzername in Mono: er ist eine Kennung, kein Name. */}
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
                  // `title` statt des in antd 6 abgelösten `message` (LFH-345 · C10, N5).
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
                      // Ein QR-Code braucht hellen Grund, auch im Nachtbetrieb — Scanner lesen
                      // dunkle Module auf hellem Feld. Der Wert kommt aus der Hellpalette.
                      background: farbenHell.flaeche,
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
                      {/* Dasselbe Primitiv wie auf der Anmeldeseite (LFH-345 · C10, M20). Hier
                    stand ein nacktes `<Input>` — ohne Ziffern-Tastatur, ohne Längengrenze,
                    ohne Ziffern-Optik. Ausgerechnet an der Stelle, an der 2FA eingerichtet
                    wird, war die schlechtere der beiden Bauformen. */}
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
