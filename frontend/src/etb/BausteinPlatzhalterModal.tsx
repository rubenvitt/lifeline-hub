// src/etb/BausteinPlatzhalterModal.tsx
import { Button, Form, Input, Modal, Space } from 'antd';
import { useEffect } from 'react';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { ermittlePlatzhalter, setzeBausteinEin, type BausteinFelder } from './bausteinEinsetzen';

interface Props {
  /** Gesetzt = dieser Baustein wird eingesetzt; null = nichts offen. */
  baustein: EtbBaustein | null;
  einsatz: EinsatzAnzeige;
  /** Liefert die fertig substituierten Felder. */
  onEinsetzen: (felder: BausteinFelder) => void;
  /** Modal ohne Einsetzen geschlossen. */
  onAbbrechenAll: () => void;
}

export default function BausteinPlatzhalterModal({ baustein, einsatz, onEinsetzen, onAbbrechenAll }: Props) {
  const [form] = Form.useForm<Record<string, string>>();
  const offenePlatzhalter = baustein ? ermittlePlatzhalter(baustein, einsatz) : [];

  // Bausteine ohne manuelle Platzhalter sofort einsetzen (kein Dialog nötig).
  useEffect(() => {
    if (baustein && offenePlatzhalter.length === 0) {
      onEinsetzen(setzeBausteinEin(baustein, einsatz, {}));
    }
    form.resetFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baustein]);

  function anwenden(werte: Record<string, string>) {
    if (!baustein) return;
    onEinsetzen(setzeBausteinEin(baustein, einsatz, werte));
    form.resetFields();
  }

  function abbrechen() {
    form.resetFields();
    onAbbrechenAll();
  }

  const dialogOffen = baustein !== null && offenePlatzhalter.length > 0;

  return (
    <Modal open={dialogOffen} title="Baustein einsetzen" footer={null} onCancel={abbrechen} destroyOnHidden>
      <Form<Record<string, string>> form={form} layout="vertical" onFinish={anwenden}>
        <Space orientation="vertical" style={{ width: '100%' }}>
          {offenePlatzhalter.map((name, index) => (
            <Form.Item key={name} name={name} label={name} style={{ marginBottom: 8 }}>
              <Input aria-label={name} autoFocus={index === 0} />
            </Form.Item>
          ))}
          <Button type="primary" htmlType="submit">Einsetzen</Button>
        </Space>
      </Form>
    </Modal>
  );
}
