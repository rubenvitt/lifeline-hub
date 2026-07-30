import { Form, Input } from 'antd';
import { useEffect } from 'react';
import { ErfassungsModal } from '../../components/Erfassung';
import type { GefahrBewertung } from '../../api/types';

interface Werte {
  beschreibung?: string;
  gemeldet_von?: string;
}

export interface GefahrenZelleDetailsProps {
  offen: boolean;
  /** Die bewertete Zelle. `null`, solange keine gewählt ist. */
  zelle: GefahrBewertung | null;
  /** „Brand × Menschen" — steht im Dialogtitel. */
  titel: string;
  laeuft: boolean;
  onSpeichern: (beschreibung: string | null, gemeldetVon: string | null) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * Beschreibung und Meldeweg einer Matrixzelle. Nimmt `ErfassungsModal` statt eines
 * handgebauten `<Modal>` + `<Form>` (Erfassungs-Norm LFH-332/B4) — vorher war das ein
 * `Popover` mit einem Knopf AUSSERHALB des Formulars, in dem Enter tot war.
 *
 * Zwei Felder, damit das Feldbudget (Modal ≤ ~3, LFH-19) eingehalten ist.
 *
 * Vorbelegen zum Bearbeiten ist ausdrücklich kein Reset (Norm B4): `setFieldsValue`
 * beim Öffnen bleibt Aufgabe des Aufrufers, das Leeren übernimmt die Hülle — auf
 * jedem Weg hinaus, auch über Escape und den Klick auf die Maske.
 */
export default function GefahrenZelleDetails({
  offen, zelle, titel, laeuft, onSpeichern, onSchliessen,
}: GefahrenZelleDetailsProps) {
  const [form] = Form.useForm<Werte>();

  useEffect(() => {
    if (offen) {
      form.setFieldsValue({
        beschreibung: zelle?.beschreibung ?? '',
        gemeldet_von: zelle?.gemeldet_von ?? '',
      });
    }
  }, [offen, zelle, form]);

  return (
    <ErfassungsModal
      offen={offen}
      titel={`Details ${titel}`}
      form={form}
      laeuft={laeuft}
      erfassenText="Speichern"
      onErfassen={(w) =>
        onSpeichern(w.beschreibung?.trim() || null, w.gemeldet_von?.trim() || null)
      }
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item name="beschreibung" label="Beschreibung">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Form.Item name="gemeldet_von" label="Gemeldet von">
        <Input />
      </Form.Item>
    </ErfassungsModal>
  );
}
