import { App, Form, Input, Modal } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereSprechgruppe, legeSprechgruppeAn } from '../api/sprechgruppen';
import type { Betriebsart, Sprechgruppe } from '../api/types';
import { globalKeys } from '../api/queryKeys';

interface FormWerte {
  bezeichnung: string;
  betriebsart: Betriebsart;
  hinweis?: string;
}

function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
}

export default function SprechgruppeFormModal({
  offen,
  sprechgruppe,
  onClose,
}: {
  offen: boolean;
  sprechgruppe: Sprechgruppe | null; // null = neu
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEffect(() => {
    if (!offen) return;
    if (sprechgruppe) {
      form.setFieldsValue({
        bezeichnung: sprechgruppe.bezeichnung,
        betriebsart: sprechgruppe.betriebsart,
        hinweis: sprechgruppe.hinweis ?? undefined,
      });
    } else {
      form.resetFields();
    }
  }, [offen, sprechgruppe, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const eingabe = {
        bezeichnung: werte.bezeichnung.trim(),
        betriebsart: werte.betriebsart,
        hinweis: leerZuNull(werte.hinweis),
      };
      return sprechgruppe
        ? aktualisiereSprechgruppe(sprechgruppe.id, eingabe)
        : legeSprechgruppeAn(eingabe);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.sprechgruppenAlle() });
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title={sprechgruppe ? 'Sprechgruppe bearbeiten' : 'Sprechgruppe anlegen'}
      okText="Speichern"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
        >
          <Input placeholder="z. B. 412_F_DRK" />
        </Form.Item>
        <Form.Item
          label="Betriebsart"
          name="betriebsart"
          rules={[{ required: true, message: 'Betriebsart ist erforderlich' }]}
        >
          <Select
            options={[
              { value: 'TMO', label: 'TMO – Trunked Mode' },
              { value: 'DMO', label: 'DMO – Direct Mode' },
            ]}
          />
        </Form.Item>
        <Form.Item label="Hinweis" name="hinweis">
          <Input placeholder="Optionaler Hinweis" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
