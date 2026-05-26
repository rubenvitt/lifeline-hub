import { App, AutoComplete, Form, Input, InputNumber, Modal, Space, Switch, Typography } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereFahrzeug, legeFahrzeugAn, type FahrzeugEingabe } from '../api/fahrzeuge';
import type { Fahrzeug } from '../api/types';

interface FormWerte {
  funkrufname: string;
  fahrzeugtyp?: string;
  traegerorganisation?: string;
  kennzeichen?: string;
  opta?: string;
  standort?: string;
  fms_issi?: string;
  sondersignal: boolean;
  tragenkapazitaet?: number;
  staerke_fuehrer?: number;
  staerke_unterfuehrer?: number;
  staerke_mannschaft?: number;
  bemerkung?: string;
}

function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
}

export default function FahrzeugFormModal({
  offen,
  fahrzeug,
  typVorschlaege,
  onClose,
}: {
  offen: boolean;
  fahrzeug: Fahrzeug | null; // null = neu
  typVorschlaege: string[];
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEffect(() => {
    if (!offen) return;
    if (fahrzeug) {
      form.setFieldsValue({
        funkrufname: fahrzeug.funkrufname,
        fahrzeugtyp: fahrzeug.fahrzeugtyp ?? undefined,
        traegerorganisation: fahrzeug.traegerorganisation ?? undefined,
        kennzeichen: fahrzeug.kennzeichen ?? undefined,
        opta: fahrzeug.opta ?? undefined,
        standort: fahrzeug.standort ?? undefined,
        fms_issi: fahrzeug.fms_issi ?? undefined,
        sondersignal: fahrzeug.sondersignal,
        tragenkapazitaet: fahrzeug.tragenkapazitaet ?? undefined,
        staerke_fuehrer: fahrzeug.staerke?.fuehrer,
        staerke_unterfuehrer: fahrzeug.staerke?.unterfuehrer,
        staerke_mannschaft: fahrzeug.staerke?.mannschaft,
        bemerkung: fahrzeug.bemerkung ?? undefined,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ sondersignal: false });
    }
  }, [offen, fahrzeug, form]);

  const sf = Form.useWatch('staerke_fuehrer', form);
  const su = Form.useWatch('staerke_unterfuehrer', form);
  const sm = Form.useWatch('staerke_mannschaft', form);
  const gesamt = sf != null && su != null && sm != null ? sf + su + sm : null;

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: FahrzeugEingabe = {
        funkrufname: werte.funkrufname.trim(),
        fahrzeugtyp: leerZuNull(werte.fahrzeugtyp),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        kennzeichen: leerZuNull(werte.kennzeichen),
        opta: leerZuNull(werte.opta),
        standort: leerZuNull(werte.standort),
        fms_issi: leerZuNull(werte.fms_issi),
        sondersignal: werte.sondersignal ?? false,
        tragenkapazitaet: werte.tragenkapazitaet ?? null,
        staerke_fuehrer: werte.staerke_fuehrer ?? null,
        staerke_unterfuehrer: werte.staerke_unterfuehrer ?? null,
        staerke_mannschaft: werte.staerke_mannschaft ?? null,
        bemerkung: leerZuNull(werte.bemerkung),
      };
      return fahrzeug ? aktualisiereFahrzeug(fahrzeug.id, daten) : legeFahrzeugAn(daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fahrzeuge'] });
      qc.invalidateQueries({ queryKey: ['fahrzeug-typen'] });
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title={fahrzeug ? 'Fahrzeug bearbeiten' : 'Fahrzeug anlegen'}
      okText="Speichern"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnClose
    >
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item
          label="Funkrufname"
          name="funkrufname"
          rules={[{ required: true, whitespace: true, message: 'Funkrufname darf nicht leer sein' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp">
          <AutoComplete
            options={typVorschlaege.map((t) => ({ value: t }))}
            allowClear
            placeholder="z. B. LF 20, RTW"
            filterOption={(input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation"><Input /></Form.Item>
        <Form.Item label="Kennzeichen" name="kennzeichen"><Input /></Form.Item>
        <Form.Item label="OPTA" name="opta"><Input /></Form.Item>
        <Form.Item label="Standort" name="standort"><Input /></Form.Item>
        <Form.Item label="FMS-ISSI" name="fms_issi"><Input /></Form.Item>
        <Form.Item label="Sonder-/Wegerecht" name="sondersignal" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="Tragenkapazität" name="tragenkapazitaet">
          <InputNumber min={0} style={{ width: 160 }} />
        </Form.Item>
        <Typography.Text type="secondary">Soll-Stärke (alle drei oder keiner)</Typography.Text>
        <Space style={{ display: 'flex', marginTop: 8 }} align="end">
          <Form.Item label="Führer" name="staerke_fuehrer"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
          <Form.Item label="Unterführer" name="staerke_unterfuehrer"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>
          <Form.Item label="Mannschaft" name="staerke_mannschaft"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>
          <div style={{ paddingBottom: 24 }}>= Gesamt: <strong>{gesamt ?? '—'}</strong></div>
        </Space>
        <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
