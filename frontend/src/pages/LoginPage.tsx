import { Alert, Button, ConfigProvider, Form, Input, Space, Tag, theme as antdTheme } from 'antd';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { devBenutzerLaden, type DevBenutzer } from '../api/dev';
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
  const [form] = Form.useForm<FormWerte>();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [devBenutzer, setDevBenutzer] = useState<DevBenutzer[]>([]);

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
                      form.setFieldsValue({ benutzername: b.benutzername, passwort: b.passwort })
                    }
                  >
                    {b.anzeigename}
                    <Tag style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>{b.rolle}</Tag>
                  </Button>
                ))}
              </Space>
            </div>
          )}
          <Form layout="vertical" form={form} onFinish={absenden} disabled={laedt} requiredMark={false}>
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
