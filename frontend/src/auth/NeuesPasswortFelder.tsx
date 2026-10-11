import { Form, Input } from 'antd';
import { PASSWORT_MIN_LAENGE } from '../api/auth';

/**
 * „Neues Passwort“ und „Neues Passwort wiederholen“ — die eine Eingabe für ein neues Passwort,
 * geteilt vom Self-Service-Wechsel (`PasswortAendernDialog`, LFH-471) und vom Schritt nach einem
 * Einmalpasswort auf der Anmeldeseite (LFH-1121). Erwartet ein umgebendes `Form` mit den Feldern
 * `neues_passwort` und `wiederholung`.
 *
 * Die Wiederholung prüft nur der Client — der Server bekommt sie nie; die Mindestlänge prüfen
 * beide, entscheidend ist der Server.
 */
export default function NeuesPasswortFelder({ autoFocus = false }: { autoFocus?: boolean }) {
  return (
    <>
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
        <Input.Password autoComplete="new-password" autoFocus={autoFocus} />
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
    </>
  );
}
