import { Form, Input, Modal } from 'antd';
import { useEffect } from 'react';
import type { ChatNachricht } from '../api/types';

interface FormWerte {
  inhalt: string;
}

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  senden: boolean;
  onAbbrechen: () => void;
  onBestaetigen: (inhalt: string) => void;
}

export default function BearbeitenModal({ offen, nachricht, senden, onAbbrechen, onBestaetigen }: Props) {
  const [form] = Form.useForm<FormWerte>();

  // Bei jedem Öffnen den aktuellen Nachrichtentext vorbefüllen.
  useEffect(() => {
    if (offen && nachricht) {
      form.setFieldsValue({ inhalt: nachricht.inhalt ?? '' });
    }
  }, [offen, nachricht, form]);

  return (
    <Modal
      open={offen}
      title="Nachricht bearbeiten"
      okText="Speichern"
      confirmLoading={senden}
      onOk={() => form.submit()}
      onCancel={onAbbrechen}
      destroyOnHidden
    >
      <Form<FormWerte>
        form={form}
        layout="vertical"
        onFinish={(w) => onBestaetigen(w.inhalt.trim())}
      >
        <Form.Item label="Text" name="inhalt" rules={[{ required: true, whitespace: true, message: 'Text erforderlich' }]}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
