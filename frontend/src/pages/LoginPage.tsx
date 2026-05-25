import { Alert, Button, ConfigProvider, Form, Input, theme as antdTheme } from 'antd';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import loginBg from '../assets/login-bg.webp';
import './LoginPage.css';

interface FormWerte {
  benutzername: string;
  passwort: string;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);

  const zielPfad = (location.state as { von?: string } | null)?.von ?? '/einsaetze';

  async function absenden(werte: FormWerte) {
    setFehler(null);
    setLaedt(true);
    try {
      await login(werte.benutzername, werte.passwort);
      navigate(zielPfad, { replace: true });
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Verbindung zum Server fehlgeschlagen');
    } finally {
      setLaedt(false);
    }
  }

  return (
    <div className="login-seite" style={{ '--login-bg': `url(${loginBg})` } as CSSProperties}>
      {/* Dunkles Theme nur für die Anmeldekarte – passend zur Lagebild-Atmosphäre. */}
      <ConfigProvider
        theme={{ algorithm: antdTheme.darkAlgorithm, token: { colorPrimary: '#a8071a' } }}
      >
        <div className="login-karte">
          <div className="login-marke">
            <span className="login-marke__akzent" />
            <h1 className="login-marke__name">lifeline-hub</h1>
            <p className="login-marke__untertitel">Einsatzführung &amp; Einsatztagebuch</p>
          </div>
          {fehler && <Alert type="error" message={fehler} style={{ marginBottom: 20 }} showIcon />}
          <Form layout="vertical" onFinish={absenden} disabled={laedt} requiredMark={false}>
            <Form.Item
              label="Benutzername"
              name="benutzername"
              rules={[{ required: true, message: 'Bitte Benutzername eingeben' }]}
            >
              <Input size="large" autoFocus autoComplete="username" />
            </Form.Item>
            <Form.Item
              label="Passwort"
              name="passwort"
              rules={[{ required: true, message: 'Bitte Passwort eingeben' }]}
            >
              <Input.Password size="large" autoComplete="current-password" />
            </Form.Item>
            <Button
              className="login-absenden"
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={laedt}
            >
              Anmelden
            </Button>
          </Form>
        </div>
      </ConfigProvider>
    </div>
  );
}
