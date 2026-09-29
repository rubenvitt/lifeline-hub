import { App, Form, Input, theme } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { PASSWORT_MIN_LAENGE, passwortAendern } from '../api/auth';

interface PasswortWerte {
  altes_passwort: string;
  neues_passwort: string;
  wiederholung: string;
}

/**
 * Self-Service-Passwortwechsel (LFH-471) — Dialog der Profilseite.
 *
 * Drei Felder, alle Pflicht, also alle sichtbar (Feldbudget Modal ≤ ~3). Die Hülle ist
 * `ErfassungsModal` (Erfassungs-Norm B4): Enter sendet, der Fokus steht im ersten Feld, jeder
 * Weg hinaus leert die Felder — bei Passwörtern die Zusage, auf die es ankommt.
 *
 * **Die Ablehnung steht im Dialog, nicht im Toast** (`SpeicherFehler`): ein falsches bisheriges
 * Passwort (422) lässt den Dialog offen und die Felder stehen, ein Toast wäre weg, bevor jemand
 * ihn liest. Der Erfolg geht an den Toast. Die Wiederholung prüft nur der Client — der Server
 * bekommt sie nie; die Mindestlänge prüfen beide, entscheidend ist der Server.
 */
export default function PasswortAendernDialog({
  offen,
  onSchliessen,
}: {
  offen: boolean;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<PasswortWerte>();
  const { message } = App.useApp();
  const { token } = theme.useToken();

  const mutation = useMutation({
    mutationFn: (werte: PasswortWerte) =>
      passwortAendern(werte.altes_passwort, werte.neues_passwort),
    onSuccess: () => {
      message.success('Passwort geändert. Andere Anmeldungen dieses Kontos sind beendet.');
    },
  });

  function schliessen() {
    // Ein Fehler aus dem letzten Versuch gehört nicht in den nächsten Dialog.
    mutation.reset();
    onSchliessen();
  }

  return (
    <ErfassungsModal<PasswortWerte>
      offen={offen}
      titel="Passwort ändern"
      form={form}
      erfassenText="Passwort ändern"
      laeuft={mutation.isPending}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen (LFH-332), sonst leert die Hülle.
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={schliessen}
      onAbbrechen={schliessen}
    >
      {mutation.error != null && (
        <div style={{ marginBottom: token.margin }}>
          <SpeicherFehler fehler={mutation.error} titel="Passwort nicht geändert" />
        </div>
      )}
      <Form.Item
        label="Bisheriges Passwort"
        name="altes_passwort"
        rules={[{ required: true, message: 'Bitte das bisherige Passwort eingeben' }]}
      >
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Form.Item
        label="Neues Passwort"
        name="neues_passwort"
        rules={[
          {
            required: true,
            min: PASSWORT_MIN_LAENGE,
            message: `Mindestens ${PASSWORT_MIN_LAENGE} Zeichen`,
          },
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        label="Neues Passwort wiederholen"
        name="wiederholung"
        dependencies={['neues_passwort']}
        rules={[
          { required: true, message: 'Bitte das neue Passwort wiederholen' },
          ({ getFieldValue }) => ({
            validator: (_, wert: string | undefined) =>
              !wert || wert === getFieldValue('neues_passwort')
                ? Promise.resolve()
                : Promise.reject(new Error('Die Wiederholung weicht vom neuen Passwort ab')),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
    </ErfassungsModal>
  );
}
