import { App, AutoComplete, Form, Input, Modal } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereMaterial, legeMaterialAn, type MaterialEingabe } from '../api/material';
import type { Material } from '../api/types';
import { globalKeys } from '../api/queryKeys';

interface FormWerte {
  bezeichnung: string;
  kategorie?: string;
  bestandsnummer?: string;
  traegerorganisation?: string;
  standort?: string;
  bemerkung?: string;
}

function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
}

export default function MaterialFormModal({
  offen,
  material,
  kategorien,
  onClose,
}: {
  offen: boolean;
  material: Material | null; // null = neu
  kategorien: string[];
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEffect(() => {
    if (!offen) return;
    if (material) {
      form.setFieldsValue({
        bezeichnung: material.bezeichnung,
        kategorie: material.kategorie ?? undefined,
        bestandsnummer: material.bestandsnummer ?? undefined,
        traegerorganisation: material.traegerorganisation ?? undefined,
        standort: material.standort ?? undefined,
        bemerkung: material.bemerkung ?? undefined,
      });
    } else {
      form.resetFields();
    }
  }, [offen, material, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: MaterialEingabe = {
        bezeichnung: werte.bezeichnung.trim(),
        kategorie: leerZuNull(werte.kategorie),
        bestandsnummer: leerZuNull(werte.bestandsnummer),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        standort: leerZuNull(werte.standort),
        bemerkung: leerZuNull(werte.bemerkung),
      };
      return material ? aktualisiereMaterial(material.id, daten) : legeMaterialAn(daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.material() });
      qc.invalidateQueries({ queryKey: globalKeys.materialKategorien() });
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title={material ? 'Material bearbeiten' : 'Material anlegen'}
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
          <Input placeholder="z. B. Wolldecke, Stromerzeuger 5 kVA" />
        </Form.Item>
        <Form.Item label="Kategorie" name="kategorie">
          <AutoComplete
            options={kategorien.map((k) => ({ value: k }))}
            allowClear
            placeholder="z. B. Betreuung, Sanität, Hochwasser"
            showSearch={{
              filterOption: (input, option) =>
                (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
            }}
          />
        </Form.Item>
        <Form.Item label="Bestandsnummer" name="bestandsnummer">
          <Input placeholder="Inventarnr. (nur für einzeln verfolgte Geräte)" />
        </Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation"><Input /></Form.Item>
        <Form.Item label="Standort" name="standort"><Input placeholder="z. B. Lagerhalle 2" /></Form.Item>
        <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
