import { Button, Card, DatePicker, Input, InputNumber, Form } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { NeueErinnerung } from '../api/types';

const { TextArea } = Input;

/// Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss' (rein, testbar).
export function dayjsZuWire(d: Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

/** Werte des Formulars (lokale Picker-Zeit vor der UTC-Wandlung). */
interface FormWerte {
  titel: string;
  beschreibung: string;
  faellig: Dayjs | null;
  intervall: number | null;
  empfaenger: string;
}

interface Props {
  senden: boolean;
  onAnlegen: (daten: NeueErinnerung) => void;
}

export default function ErinnerungFormular({ senden, onAnlegen }: Props) {
  const [form] = Form.useForm<FormWerte>();

  const onFinish = (w: FormWerte) => {
    if (!w.faellig) return; // durch Pflicht-Rule abgedeckt, hier nur Typ-Guard
    onAnlegen({
      titel: w.titel.trim(),
      beschreibung: w.beschreibung?.trim() || undefined,
      faellig_at: dayjsZuWire(w.faellig),
      intervall_minuten: w.intervall ?? undefined,
      empfaenger_funktion: w.empfaenger?.trim() || undefined,
    });
    form.resetFields(); // Default-Datum (initialValues) bleibt erhalten
  };

  return (
    <Card size="small" title="Neue Erinnerung">
      <Form<FormWerte>
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{ titel: '', beschreibung: '', faellig: dayjs(), intervall: null, empfaenger: '' }}
      >
        <Form.Item
          name="titel"
          label="Titel / Anlass"
          rules={[{ required: true, message: 'Titel ist erforderlich' }]}
        >
          <Input aria-label="Titel" placeholder="z. B. Lagemeldung aller EA" />
        </Form.Item>
        <Form.Item name="beschreibung" label="Beschreibung (optional)">
          <TextArea aria-label="Beschreibung" rows={2} />
        </Form.Item>
        <Form.Item
          name="faellig"
          label="Fällig"
          rules={[{ required: true, message: 'Fälligkeit ist erforderlich' }]}
        >
          <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="intervall" label="Intervall (Min, optional)">
          <InputNumber aria-label="Intervall" min={1} placeholder="30" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="empfaenger" label="Empfänger/Funktion (optional)">
          <Input aria-label="Empfänger" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={senden} block>Anlegen</Button>
      </Form>
    </Card>
  );
}
