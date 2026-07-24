import { App, Form, Input, InputNumber, Modal, Typography } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereBaustein, legeBausteinAn, type BausteinEingabe } from '../api/etbBaustein';
import type { EtbBaustein, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN, TYP_LABEL } from '../etb/typFarben';
import { AUTO_PLATZHALTER } from '../etb/bausteinEinsetzen';
import { MELDEWEG_OPTIONEN } from '../etb/schnellerfassungModell';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';

interface FormWerte {
  label: string;
  typ: EtbTyp;
  inhalt: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  sortier: number;
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
      qc.invalidateQueries({ queryKey: globalKeys.etbBausteine() });
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
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Vorkonfigurierte Platzhalter werden beim Einsetzen automatisch befüllt:{' '}
              {AUTO_PLATZHALTER.map((p) => (
                <span key={p.name}>
                  <code>{`{${p.name}}`}</code> ({p.beschreibung}){' '}
                </span>
              ))}
              . Beliebige weitere Platzhalter wie <code>{'{einheit}'}</code> werden beim Einsetzen
              abgefragt. Gilt auch für die Veranlassung.
            </Typography.Text>
          }
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
