import { Alert, Button, Space, Typography } from 'antd';
import { useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { appCodeAusstellen } from '../api/auth';
import { fehlerText } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import './LoginPage.css';

/**
 * Bestätigung „In der Mac-App anmelden als …“ (LFH-818,
 * `openspec/changes/lfh-818-anmeldung-im-systembrowser/design.md`, Entscheidung 2).
 *
 * Die macOS-Hülle öffnet diese Seite im Systembrowser (`ASWebAuthenticationSession`) mit der
 * `challenge` ihres PKCE-Geheimnisses. Ohne Sitzung führt `RequireAuth` zur Anmeldung und mit der
 * vollen Adresse zurück — jeder Anmeldeweg des Browsers trägt so auch in die App. Den Code gibt es
 * erst nach dem Klick; er geht nur als `lifeline://anmeldung?code=…` zurück in die App und steht
 * nie auf der Seite.
 */

const CHALLENGE_FORM = /^[A-Za-z0-9_-]{43}$/;

interface Props {
  /** Navigation auf das Schema der App. Injizierbar, weil jsdom kein fremdes Schema öffnet. */
  navigiere?: (adresse: string) => void;
}

export default function AppAnmeldungPage({ navigiere = (a) => window.location.assign(a) }: Props) {
  const { benutzer, logout } = useAuth();
  const location = useLocation();
  const challenge = new URLSearchParams(location.search).get('challenge') ?? '';
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zurueck, setZurueck] = useState(false);
  /** Riegel gegen zwei Codes bei schnellem Doppelklick (State greift erst nach dem Rendern). */
  const sendetRef = useRef(false);

  async function inDerAppAnmelden() {
    if (sendetRef.current) return;
    sendetRef.current = true;
    setLaeuft(true);
    setFehler(null);
    try {
      const { code } = await appCodeAusstellen(challenge);
      navigiere(`lifeline://anmeldung?code=${encodeURIComponent(code)}`);
      setZurueck(true);
    } catch (e) {
      setFehler(fehlerText(e, 'Die Anmeldung für die Mac-App ist fehlgeschlagen.'));
    } finally {
      sendetRef.current = false;
      setLaeuft(false);
    }
  }

  let inhalt;
  if (!CHALLENGE_FORM.test(challenge)) {
    inhalt = (
      <Alert
        type="error"
        showIcon
        title="Dieser Link ist unvollständig. Starte die Anmeldung in der Mac-App erneut."
      />
    );
  } else if (zurueck) {
    inhalt = (
      <Typography.Paragraph>
        Die Mac-App übernimmt die Anmeldung. Du kannst dieses Fenster schließen.
      </Typography.Paragraph>
    );
  } else {
    inhalt = (
      <>
        <Typography.Title level={2} style={{ fontSize: 20, marginTop: 0 }}>
          In der Mac-App anmelden als {benutzer?.anzeigename}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Die Mac-App wird mit diesem Konto ({benutzer?.benutzername}) angemeldet. Bist das nicht
          du, melde dich mit deinem eigenen Konto an.
        </Typography.Paragraph>
        {/* Gegen untergeschobene Links: der Code geht an die Mac-App auf DIESEM Gerät, eine
            Bestätigung ohne eigenen Anstoß aus der App meldet womöglich eine fremde App an. */}
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="Bestätige nur, wenn du gerade in der Mac-App auf „Im Browser anmelden“ geklickt hast."
        />
        {fehler && <Alert type="error" showIcon title={fehler} style={{ marginBottom: 16 }} />}
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Button type="primary" size="large" block loading={laeuft} onClick={inDerAppAnmelden}>
            In der App anmelden
          </Button>
          <Button size="large" block disabled={laeuft} onClick={() => void logout()}>
            Mit anderem Konto
          </Button>
        </Space>
      </>
    );
  }

  return (
    <div className="login-seite">
      <div className="login-karte">
        <div className="login-marke">
          <div className="login-marke__zeile">
            <span className="login-marke__quadrat" aria-hidden="true" />
            <h1 className="login-marke__name">lifeline-hub</h1>
          </div>
          <p className="login-marke__untertitel">Anmeldung für die Mac-App</p>
        </div>
        {inhalt}
      </div>
    </div>
  );
}
