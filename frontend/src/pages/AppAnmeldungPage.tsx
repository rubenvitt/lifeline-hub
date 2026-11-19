import { Alert, Button, Space, Typography, theme } from 'antd';
import { useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { appCodeAusstellen } from '../api/auth';
import { fehlerText } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Stapel, Textstufe } from '../components/instrument';
import { Bildmarke } from '../marke/Bildmarke';
import './LoginPage.css';

/**
 * Bestätigung „In der Lifeline-App anmelden als …“ (LFH-818,
 * `openspec/changes/archive/2026-09-30-lfh-818-anmeldung-im-systembrowser/design.md`, Entscheidung 2).
 * Plattformneutral (t39ltxxi): derselbe Weg dient der macOS- und der iOS-Hülle.
 *
 * Die Hülle öffnet diese Seite im Systembrowser (`ASWebAuthenticationSession`) mit der
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
  const { token } = theme.useToken();
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
      setFehler(fehlerText(e, 'Die Anmeldung für die Lifeline-App ist fehlgeschlagen.'));
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
        title="Dieser Link ist unvollständig. Starte die Anmeldung in der Lifeline-App erneut."
      />
    );
  } else if (zurueck) {
    inhalt = (
      <Typography.Paragraph>
        An die Lifeline-App übergeben. Dieses Fenster kann zu.
      </Typography.Paragraph>
    );
  } else {
    inhalt = (
      <>
        <Stapel abstand="xs">
          <Textstufe als="h2" stufe="kartentitel">
            In der Lifeline-App anmelden als {benutzer?.anzeigename}
          </Textstufe>
          <Typography.Paragraph type="secondary">
            Konto {benutzer?.benutzername}
          </Typography.Paragraph>
        </Stapel>
        {/* Gegen untergeschobene Links: der Code geht an die Lifeline-App auf DIESEM Gerät, eine
            Bestätigung ohne eigenen Anstoß aus der App meldet womöglich eine fremde App an. */}
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: token.marginLG }}
          title="Nur bestätigen, wenn gerade in der Lifeline-App „Im Browser anmelden“ gewählt wurde."
        />
        {fehler && (
          <Alert type="error" showIcon title={fehler} style={{ marginBottom: token.marginLG }} />
        )}
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
            <Bildmarke hoehe={20} linienFarbe="var(--lfh-text)" quadratFarbe="var(--lfh-marke)" />
            <h1 className="login-marke__name">lifeline-hub</h1>
          </div>
          <p className="login-marke__untertitel">Anmeldung für die Lifeline-App</p>
        </div>
        {inhalt}
      </div>
    </div>
  );
}
