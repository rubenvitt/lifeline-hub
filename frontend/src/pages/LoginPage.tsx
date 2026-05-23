import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

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
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={3}>lifeline-hub</Typography.Title>
        {fehler && <Alert type="error" message={fehler} style={{ marginBottom: 16 }} showIcon />}
        <Form layout="vertical" onFinish={absenden} disabled={laedt}>
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
