import { Button, Form, Input, Modal, Popconfirm, Select, Space } from 'antd';
import type { FormInstance } from 'antd';
import { useState } from 'react';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { ermittlePlatzhalter, setzeBausteinEin } from './bausteinEinsetzen';

interface Props {
  form: FormInstance;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
}

export default function BausteinPicker({ form, bausteine, einsatz }: Props) {
  const [dialogBaustein, setDialogBaustein] = useState<EtbBaustein | null>(null);
  const [offenePlatzhalter, setOffenePlatzhalter] = useState<string[]>([]);
  const [werte, setWerte] = useState<Record<string, string>>({});

  function anwenden(baustein: EtbBaustein, manuelleWerte: Record<string, string>) {
    const felder = setzeBausteinEin(baustein, einsatz, manuelleWerte);
    form.setFieldsValue(felder);
    setDialogBaustein(null);
    setWerte({});
  }

  function auswahl(id: number) {
    const baustein = bausteine.find((b) => b.id === id);
    if (!baustein) return;
    const manuell = ermittlePlatzhalter(baustein, einsatz);
    const inhaltGefuellt = (form.getFieldValue('inhalt') ?? '').trim().length > 0;
    if (manuell.length === 0 && !inhaltGefuellt) {
      anwenden(baustein, {});
      return;
    }
    setWerte({});
    setOffenePlatzhalter(manuell);
    setDialogBaustein(baustein);
  }

  const inhaltGefuellt = (form.getFieldValue('inhalt') ?? '').trim().length > 0;

  return (
    <>
      <Select
        placeholder="Baustein einsetzen …"
        style={{ marginBottom: 8, minWidth: 220 }}
        value={null}
        onChange={auswahl}
        options={bausteine.map((b) => ({ value: b.id, label: b.label }))}
      />

      <Modal
        open={dialogBaustein !== null}
        title="Baustein einsetzen"
        footer={null}
        onCancel={() => setDialogBaustein(null)}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {offenePlatzhalter.map((name) => (
            <Form.Item key={name} label={name} style={{ marginBottom: 8 }}>
              <Input
                value={werte[name] ?? ''}
                onChange={(e) => setWerte((w) => ({ ...w, [name]: e.target.value }))}
              />
            </Form.Item>
          ))}
          {inhaltGefuellt ? (
            <Popconfirm
              title="Vorhandenen Inhalt ersetzen?"
              onConfirm={() => dialogBaustein && anwenden(dialogBaustein, werte)}
            >
              <Button type="primary">Einsetzen</Button>
            </Popconfirm>
          ) : (
            <Button type="primary" onClick={() => dialogBaustein && anwenden(dialogBaustein, werte)}>
              Einsetzen
            </Button>
          )}
        </Space>
      </Modal>
    </>
  );
}
