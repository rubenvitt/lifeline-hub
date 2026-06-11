import { useState } from 'react';
import { Button, DatePicker, Input, InputNumber, Space, Form } from 'antd';
import { type Dayjs } from 'dayjs';
import type { NeueErinnerung } from '../api/types';

/// Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss' (rein, testbar).
export function dayjsZuWire(d: Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

interface Props {
  senden: boolean;
  onAnlegen: (daten: NeueErinnerung) => void;
}

export default function ErinnerungFormular({ senden, onAnlegen }: Props) {
  const [titel, setTitel] = useState('');
  const [faellig, setFaellig] = useState<Dayjs | null>(null);
  const [intervall, setIntervall] = useState<number | null>(null);
  const [empfaenger, setEmpfaenger] = useState('');

  const absenden = () => {
    if (!titel.trim() || !faellig) return;
    onAnlegen({
      titel: titel.trim(),
      faellig_at: dayjsZuWire(faellig),
      intervall_minuten: intervall ?? undefined,
      empfaenger_funktion: empfaenger.trim() || undefined,
    });
    setTitel(''); setFaellig(null); setIntervall(null); setEmpfaenger('');
  };

  return (
    <Form layout="vertical" onFinish={absenden}>
      <Form.Item label="Titel / Anlass">
        <Input aria-label="Titel" value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="z. B. Lagemeldung aller EA" />
      </Form.Item>
      <Form.Item label="Fällig">
        <DatePicker showTime format="YYYY-MM-DD HH:mm" value={faellig} onChange={setFaellig} style={{ width: '100%' }} />
      </Form.Item>
      <Space>
        <Form.Item label="Intervall (Min, optional)">
          <InputNumber aria-label="Intervall" min={1} value={intervall} onChange={setIntervall} placeholder="30" />
        </Form.Item>
        <Form.Item label="Empfänger/Funktion (optional)">
          <Input aria-label="Empfänger" value={empfaenger} onChange={(e) => setEmpfaenger(e.target.value)} />
        </Form.Item>
      </Space>
      <Button type="primary" htmlType="submit" loading={senden}>Anlegen</Button>
    </Form>
  );
}
