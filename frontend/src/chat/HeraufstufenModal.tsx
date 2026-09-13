import { Form, Input, Modal } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import type { ChatNachricht, EtbTyp } from '../api/types';

/** Für die Heraufstufung zulässige ETB-Typen (Server erzwingt dieselbe Allowlist). */
const TYP_OPTIONEN: { value: EtbTyp; label: string }[] = [
  { value: 'meldung', label: 'Meldung' },
  { value: 'anordnung', label: 'Anordnung' },
  { value: 'lage', label: 'Lage' },
  { value: 'entscheidung', label: 'Entscheidung' },
];

interface FormWerte {
  typ: EtbTyp;
  inhalt: string;
}

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  senden: boolean;
  onAbbrechen: () => void;
  onBestaetigen: (typ: EtbTyp, inhalt: string) => void;
}

export default function HeraufstufenModal({
  offen,
  nachricht,
  senden,
  onAbbrechen,
  onBestaetigen,
}: Props) {
  const [form] = Form.useForm<FormWerte>();

  // Bei jedem Öffnen den aktuellen Nachrichtentext vorbefüllen.
  useEffect(() => {
    if (offen && nachricht) {
      form.setFieldsValue({ typ: 'meldung', inhalt: nachricht.inhalt ?? '' });
    }
  }, [offen, nachricht, form]);

  return (
    <Modal
      open={offen}
      title="Zu ETB heraufstufen"
      okText="Heraufstufen"
      confirmLoading={senden}
      onOk={() => form.submit()}
      onCancel={onAbbrechen}
      destroyOnHidden
    >
      <Form<FormWerte>
        form={form}
        layout="vertical"
        onFinish={(w) => onBestaetigen(w.typ, w.inhalt.trim())}
      >
        <Form.Item label="ETB-Typ" name="typ" rules={[{ required: true }]}>
          <Select options={TYP_OPTIONEN} />
        </Form.Item>
        <Form.Item
          label="Text"
          name="inhalt"
          rules={[{ required: true, whitespace: true, message: 'Text erforderlich' }]}
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
