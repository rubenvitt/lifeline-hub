import { Form, Modal } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import type { BezugTyp, ChatNachricht } from '../api/types';
import { BEZUG_TYP_OPTIONEN, type BezugOptionen } from './bezug';

interface FormWerte {
  typ?: BezugTyp;
  ziel_id?: number;
}

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  /** Wählbare Objekte je Typ (aus den Listen-Queries der ChatPage). */
  optionen: BezugOptionen;
  senden: boolean;
  onAbbrechen: () => void;
  onBestaetigen: (typ: BezugTyp, zielId: number) => void;
}

/** Dialog zum nachträglichen Setzen/Ändern des polymorphen Sachbezugs (LFH-103):
 *  Typ wählen, dann ein Objekt dieses Typs. Muster: HeraufstufenModal. */
export default function BezugDialog({
  offen, nachricht, optionen, senden, onAbbrechen, onBestaetigen,
}: Props) {
  const [form] = Form.useForm<FormWerte>();
  const typ = Form.useWatch('typ', form);

  // Beim Öffnen mit dem bestehenden Bezug vorbefüllen (Ändern-Fall) bzw. leeren.
  useEffect(() => {
    if (offen) {
      form.setFieldsValue({
        typ: nachricht?.bezug_typ ?? undefined,
        ziel_id: nachricht?.bezug_id ?? undefined,
      });
    }
  }, [offen, nachricht, form]);

  const objektOptionen = typ ? optionen[typ] : [];

  return (
    <Modal
      open={offen}
      title="Bezug setzen"
      okText="Speichern"
      confirmLoading={senden}
      onOk={() => form.submit()}
      onCancel={onAbbrechen}
      destroyOnHidden
    >
      <Form<FormWerte>
        form={form}
        layout="vertical"
        onFinish={(w) => {
          if (w.typ && w.ziel_id != null) onBestaetigen(w.typ, w.ziel_id);
        }}
      >
        <Form.Item label="Typ" name="typ" rules={[{ required: true, message: 'Typ wählen' }]}>
          <Select
            options={BEZUG_TYP_OPTIONEN}
            // Objekt-Auswahl bei Typ-Wechsel zurücksetzen (sie ist typ-spezifisch).
            onChange={() => form.setFieldsValue({ ziel_id: undefined })}
          />
        </Form.Item>
        <Form.Item label="Objekt" name="ziel_id" rules={[{ required: true, message: 'Objekt wählen' }]}>
          <Select
            options={objektOptionen}
            disabled={!typ}
            notFoundContent={typ ? 'Keine Objekte' : 'Zuerst Typ wählen'}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
