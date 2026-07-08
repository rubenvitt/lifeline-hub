import { App, DatePicker, Form, Input, Modal } from 'antd';
import dayjs from 'dayjs';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { legeErinnerungAn } from '../api/erinnerungen';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { EtbEintragAnzeige } from '../api/types';

const { TextArea } = Input;

/** Kürzt den ETB-Eintragstext zu einem brauchbaren Erinnerungs-Titel. */
function titelAusEintrag(inhalt: string): string {
  const eineZeile = inhalt.replace(/\s+/g, ' ').trim();
  const kurz = eineZeile.length > 80 ? `${eineZeile.slice(0, 77)}…` : eineZeile;
  return `Wiedervorlage: ${kurz}`;
}

interface FormWerte {
  titel: string;
  faellig: dayjs.Dayjs;
  beschreibung?: string;
}

/**
 * Legt aus einem ETB-Eintrag eine terminierte Erinnerung/Wiedervorlage an (LFH-106).
 * Hält den Bezug auf den Quell-Eintrag fest (bezug_typ='etb'/bezug_id); die
 * Erinnerungsliste verweist darüber zurück. Bewusst schlank gehalten (eigenes Modal
 * statt des großen ErinnerungFormulars).
 */
export default function WiedervorlageModal({ einsatzId, eintrag, onClose }: {
  einsatzId: number;
  eintrag: EtbEintragAnzeige | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<FormWerte>();

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) =>
      legeErinnerungAn(einsatzId, {
        titel: werte.titel.trim(),
        faellig_at: werte.faellig.utc().format('YYYY-MM-DD HH:mm:ss'),
        beschreibung: werte.beschreibung?.trim() || undefined,
        bezug_typ: 'etb',
        bezug_id: eintrag!.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.erinnerungen(einsatzId) });
      message.success('Wiedervorlage angelegt');
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  return (
    <Modal
      open={eintrag !== null}
      title="Wiedervorlage anlegen"
      okText="Anlegen"
      cancelText="Abbrechen"
      confirmLoading={mutation.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      {eintrag && (
        <Form<FormWerte>
          form={form}
          layout="vertical"
          initialValues={{ titel: titelAusEintrag(eintrag.inhalt), faellig: dayjs() }}
          onFinish={(werte) => mutation.mutate(werte)}
        >
          <Form.Item label="Titel" name="titel" rules={[{ required: true, message: 'Titel ist erforderlich' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Fällig am" name="faellig" rules={[{ required: true, message: 'Fälligkeit ist erforderlich' }]}>
            <DatePicker showTime style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
          </Form.Item>
          <Form.Item label="Beschreibung (optional)" name="beschreibung">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
