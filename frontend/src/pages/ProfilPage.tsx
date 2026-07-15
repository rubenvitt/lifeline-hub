import { Alert, Button, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import Platzhalter from '../components/Platzhalter';
import { ApiError } from '../api/client';
import { providerListe } from '../api/auth';
import { webauthnRegistrierungAbschliessen, webauthnRegistrierungStarten } from '../api/webauthn';
import type { AuthProvider } from '../api/types';

export default function ProfilPage() {
  const [provider, setProvider] = useState<AuthProvider[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState(false);
  const [laedt, setLaedt] = useState(false);

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

  return (
    <div>
      {passkeySichtbar && (
        <div style={{ maxWidth: 480, marginBottom: 32 }}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Passkey
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            Registriere einen Passkey für passwortlose Anmeldung auf diesem Gerät.
          </Typography.Paragraph>
          {fehler && <Alert type="error" title={fehler} showIcon style={{ marginBottom: 12 }} />}
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
        </div>
      )}

      <Platzhalter
        titel="Profil"
        beschreibung="Eigener Account und app-weite Einstellungen."
      />
    </div>
  );
}
