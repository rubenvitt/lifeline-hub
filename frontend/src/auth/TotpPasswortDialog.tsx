import { Form, Input, theme } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { enrollStart } from '../api/totp';
import type { TotpEnrollStart } from '../api/types';

interface PasswortWerte {
  passwort: string;
}

/**
 * Erster Schritt der TOTP-Einrichtung auf der Profilseite (LFH-1013): das aktuelle Passwort.
 * Ohne diese Abfrage richtete jemand mit einer fremden Sitzung seinen eigenen Zweitfaktor ein und
 * sperrte den Eigentümer aus. Erst `enrollStart` mit gültigem Passwort liefert QR-Code und
 * Schlüssel; die gibt der Dialog über `onGestartet` an die Seite.
 *
 * Hülle und Ablehnung wie `PasswortAendernDialog`: `ErfassungsModal` (Erfassungs-Norm B4), ein
 * falsches Passwort (422) oder eine gesperrte Quelle (429) steht im Dialog, die Felder bleiben.
 */
export default function TotpPasswortDialog({
  offen,
  onGestartet,
  onSchliessen,
}: {
  offen: boolean;
  onGestartet: (start: TotpEnrollStart) => void;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<PasswortWerte>();
  const { token } = theme.useToken();

  const mutation = useMutation({
    mutationFn: (werte: PasswortWerte) => enrollStart(werte.passwort),
    onSuccess: onGestartet,
  });

  function schliessen() {
    // Ein Fehler aus dem letzten Versuch gehört nicht in den nächsten Dialog.
    mutation.reset();
    onSchliessen();
  }

  return (
    <ErfassungsModal<PasswortWerte>
      offen={offen}
      titel="Zweiten Faktor einrichten"
      form={form}
      erfassenText="Weiter"
      laeuft={mutation.isPending}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen (LFH-332), sonst leert die Hülle.
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={schliessen}
      onAbbrechen={schliessen}
    >
      {mutation.error != null && (
        <div style={{ marginBottom: token.margin }}>
          <SpeicherFehler fehler={mutation.error} titel="Einrichtung nicht gestartet" />
        </div>
      )}
      <Form.Item
        label="Aktuelles Passwort"
        name="passwort"
        rules={[{ required: true, message: 'Bitte das aktuelle Passwort eingeben' }]}
      >
        <Input.Password autoComplete="current-password" />
      </Form.Item>
    </ErfassungsModal>
  );
}
