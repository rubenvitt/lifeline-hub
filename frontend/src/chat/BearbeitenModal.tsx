import { Form, Input } from 'antd';
import { useEffect } from 'react';
import { ErfassungsModal } from '../components/Erfassung';
import type { ChatNachricht } from '../api/types';

interface FormWerte {
  inhalt: string;
}

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  senden: boolean;
  onAbbrechen: () => void;
  /** Speichern. Muss bei Ablehnung ablehnen (`mutateAsync`), sonst leert die Hülle. */
  onBestaetigen: (inhalt: string) => Promise<unknown>;
}

/** Nachricht bearbeiten, auf der Erfassungshülle (`frontend/AGENTS.md`, Erfassungs-Norm). */
export default function BearbeitenModal({
  offen,
  nachricht,
  senden,
  onAbbrechen,
  onBestaetigen,
}: Props) {
  const [form] = Form.useForm<FormWerte>();

  // VORBELEGUNG, kein Zurücksetzen: Zurückgesetzt wird von der Hülle auf jedem Weg hinaus.
  useEffect(() => {
    if (offen && nachricht) {
      form.setFieldsValue({ inhalt: nachricht.inhalt ?? '' });
    }
  }, [offen, nachricht, form]);

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="Nachricht bearbeiten"
      form={form}
      erfassenText="Speichern"
      laeuft={senden}
      onErfassen={(w) => onBestaetigen(w.inhalt.trim())}
      onFertig={onAbbrechen}
      onAbbrechen={onAbbrechen}
    >
      <Form.Item
        label="Text"
        name="inhalt"
        rules={[{ required: true, whitespace: true, message: 'Text erforderlich' }]}
      >
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
      </Form.Item>
    </ErfassungsModal>
  );
}
