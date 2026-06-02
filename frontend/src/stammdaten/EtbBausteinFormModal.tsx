import { App, Form, Input, InputNumber, Modal, Select } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereBaustein, legeBausteinAn, type BausteinEingabe } from '../api/etbBaustein';
import type { EtbBaustein, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN, TYP_LABEL } from '../etb/typFarben';

interface FormWerte {
  label: string;
  typ: EtbTyp;
  inhalt: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  sortier: number;
}

const MELDEWEG_OPTIONEN: { value: MeldeWeg; label: string }[] = [
  { value: 'funk', label: 'Funk' },
  { value: 'telefon', label: 'Telefon' },
  { value: 'persoenlich', label: 'Persönlich' },
  { value: 'sonstige', label: 'Sonstige' },
];

function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
}

export default function EtbBausteinFormModal({
  offen,
  baustein,
  onClose,
}: {
  offen: boolean;
  baustein: EtbBaustein | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEffect(() => {
    if (!offen) return;
    if (baustein) {
      form.setFieldsValue({
        label: baustein.label,
        typ: baustein.typ,
        inhalt: baustein.inhalt,
        meldeweg: baustein.meldeweg ?? undefined,
        veranlassung: baustein.veranlassung ?? undefined,
        sortier: baustein.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ typ: 'meldung', sortier: 0 });
    }
  }, [offen, baustein, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: BausteinEingabe = {
        label: werte.label.trim(),
        typ: werte.typ,
        inhalt: werte.inhalt.trim(),
        meldeweg: werte.meldeweg ?? null,
        veranlassung: leerZuNull(werte.veranlassung),
        sortier: werte.sortier ?? 0,
      };
      return baustein ? aktualisiereBaustein(baustein.id, daten) : legeBausteinAn(daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['etb-bausteine'] });
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title={baustein ? 'Baustein bearbeiten' : 'Baustein anlegen'}
      okText="Speichern"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
          <Input placeholder="z. B. Lage unverändert" />
        </Form.Item>
        <Form.Item label="Typ" name="typ" rules={[{ required: true }]}>
          <Select options={ERFASSBARE_TYPEN.map((t) => ({ value: t, label: TYP_LABEL[t] }))} />
        </Form.Item>
        <Form.Item
          label="Inhalt (Platzhalter wie {einheit} erlaubt)"
          name="inhalt"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input.TextArea rows={2} placeholder="Vorlagentext mit {platzhalter}" />
        </Form.Item>
        <Form.Item label="Meldeweg (optional)" name="meldeweg">
          <Select allowClear options={MELDEWEG_OPTIONEN} />
        </Form.Item>
        <Form.Item label="Veranlassung (optional)" name="veranlassung">
          <Input />
        </Form.Item>
        <Form.Item label="Sortierung" name="sortier">
          <InputNumber min={0} style={{ width: 120 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
