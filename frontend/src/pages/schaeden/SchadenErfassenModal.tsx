import { useEffect, useState } from 'react';
import { App, Form, Input, Modal, Select } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import { legeSchadenAn, type SchadenEingabe } from '../../api/einsatzSchaden';
import type { Ausmass, SchadenTyp } from '../../api/types';
import GeschaedigtPicker, { type GeschaedigtWert } from './GeschaedigtPicker';
import { AUSMASS_META, TYP_LABEL, geschaedigtFelder } from './schadenHelfer';

interface Props {
  open: boolean;
  onClose: () => void;
  einsatzId: number;
  /** Org-ID der eigenen Organisation (für die Geschädigt-XOR-Abbildung). */
  orgId: number;
  /** Anzeigename der eigenen Organisation (Org-Option im GeschaedigtPicker). */
  orgName: string;
}

/** Schnellerfassungs-Modal für Schäden. Props-gesteuert: die Seite hält nur den `open`-State
 *  (Trigger-Button, ?neu=1), dieses Modal besitzt Formular, Geschädigt-Auswahl und die
 *  Anlege-Mutation. Nach dem Schließen wird alles geleert (antd `preserve` würde die Werte
 *  sonst über das nächste Öffnen hinweg behalten). Feldreihenfolge (Typ, Ausmaß, Geschädigt)
 *  ist stabil — der Test wählt die Comboboxen per Index. */
export default function SchadenErfassenModal({ open, onClose, einsatzId, orgId, orgName }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<SchadenEingabe>();
  // Geschädigt ist ein strukturierter Wert → lokaler State (kein Form.Item).
  const [geschaedigt, setGeschaedigt] = useState<GeschaedigtWert>(null);

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setGeschaedigt(null);
    }
  }, [open, form]);

  const anlegenMutation = useMutation({
    mutationFn: (v: SchadenEingabe) => legeSchadenAn(einsatzId, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      onClose();
    },
    onError: (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  function onErfassen(daten: SchadenEingabe) {
    anlegenMutation.mutate({
      typ: daten.typ,
      ausmass: daten.ausmass,
      ort: daten.ort,
      beschreibung: daten.beschreibung ?? null,
      ...geschaedigtFelder(geschaedigt, orgId),
    });
  }

  return (
    <Modal
      title="Schaden erfassen"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Anlegen"
      confirmLoading={anlegenMutation.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onErfassen}>
        <Form.Item label="Typ" name="typ" rules={[{ required: true, message: 'Typ ist Pflicht' }]}>
          <Select options={(Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ value: t, label: TYP_LABEL[t] }))} />
        </Form.Item>
        <Form.Item label="Ausmaß" name="ausmass" rules={[{ required: true, message: 'Ausmaß ist Pflicht' }]}>
          <Select options={(Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({ value: a, label: AUSMASS_META[a].label }))} />
        </Form.Item>
        <Form.Item label="Ort" name="ort" rules={[{ required: true, message: 'Ort ist Pflicht' }]}>
          <Input placeholder="z. B. Hauptstr. 17 oder L 235 km 12,5" />
        </Form.Item>
        <Form.Item label="Beschreibung" name="beschreibung">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item label="Geschädigt">
          <GeschaedigtPicker
            einsatzId={einsatzId}
            orgName={orgName}
            value={geschaedigt}
            onChange={setGeschaedigt}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
