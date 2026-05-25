import { Alert, Button, Card, Form, Input, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { devBenutzerLaden, type DevBenutzer } from '../api/dev';
import { useAuth } from '../auth/AuthContext';

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
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={3}>lifeline-hub</Typography.Title>
        {fehler && <Alert type="error" message={fehler} style={{ marginBottom: 16 }} showIcon />}
        {import.meta.env.DEV && devBenutzer.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Typography.Text type="secondary">Dev-Schnellanmeldung</Typography.Text>
            <Space wrap style={{ display: 'flex', marginTop: 8 }}>
              {devBenutzer.map((b) => (
                <Button
                  key={b.benutzername}
                  size="small"
                  onClick={() =>
                    form.setFieldsValue({ benutzername: b.benutzername, passwort: b.passwort })
                  }
                >
                  {b.anzeigename}
                  <Tag style={{ marginLeft: 4 }}>{b.rolle}</Tag>
                </Button>
              ))}
            </Space>
          </div>
        )}
        <Form form={form} layout="vertical" onFinish={absenden} disabled={laedt}>
          <Form.Item
            label="Benutzername"
            name="benutzername"
            rules={[{ required: true, message: 'Bitte Benutzername eingeben' }]}
          >
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="Passwort"
            name="passwort"
            rules={[{ required: true, message: 'Bitte Passwort eingeben' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={laedt}>
            Anmelden
          </Button>
        </Form>
      </Card>
    </div>
  );
}
