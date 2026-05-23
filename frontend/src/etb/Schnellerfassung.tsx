import { Alert, Button, Card, Collapse, DatePicker, Form, Input, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import type { NeuerEintrag } from '../api/etb';
import type { EtbEintragAnzeige, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN, TYP_LABEL } from './typFarben';

interface Props {
  erfassen: (eintrag: NeuerEintrag) => Promise<void>;
  /** Gesetzt = Berichtigungsmodus für diesen Originaleintrag. */
  berichtigungZu: EtbEintragAnzeige | null;
  onBerichtigungAbbrechen: () => void;
}

interface FormWerte {
  typ: EtbTyp;
  inhalt: string;
  von?: string;
  an?: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  ereigniszeit?: dayjs.Dayjs;
}

const TYP_OPTIONEN = ERFASSBARE_TYPEN.map((t) => ({ value: t, label: TYP_LABEL[t] }));
const MELDEWEG_OPTIONEN: { value: MeldeWeg; label: string }[] = [
  { value: 'funk', label: 'Funk' },
  { value: 'telefon', label: 'Telefon' },
  { value: 'persoenlich', label: 'Persönlich' },
  { value: 'sonstige', label: 'Sonstige' },
];

export default function Schnellerfassung({ erfassen, berichtigungZu, onBerichtigungAbbrechen }: Props) {
  const [form] = Form.useForm<FormWerte>();
  const [sendet, setSendet] = useState(false);

  // Im Berichtigungsmodus fokussiert das Inhaltsfeld; bei Moduswechsel Felder zurücksetzen.
  useEffect(() => {
    if (berichtigungZu) form.resetFields();
  }, [berichtigungZu, form]);

  async function absenden(werte: FormWerte) {
    setSendet(true);
    try {
      const jetztIso = new Date().toISOString();
      const eintrag: NeuerEintrag = {
        typ: berichtigungZu ? 'berichtigung' : werte.typ,
        inhalt: werte.inhalt,
        von: werte.von || undefined,
        an: werte.an || undefined,
        meldeweg: werte.meldeweg || undefined,
        veranlassung: werte.veranlassung || undefined,
        // ereigniszeit clientseitig setzen (Default jetzt), damit gepufferte Einträge
        // ihre tatsächliche Ereigniszeit behalten (Spec §11).
        ereigniszeit: werte.ereigniszeit
          ? werte.ereigniszeit.utc().format('YYYY-MM-DD HH:mm:ss')
          : jetztIso,
        erfasst_lokal_at: jetztIso,
        berichtigt_eintrag_id: berichtigungZu ? berichtigungZu.id : undefined,
      };
      await erfassen(eintrag);
      form.resetFields();
      if (berichtigungZu) onBerichtigungAbbrechen();
    } finally {
      setSendet(false);
    }
  }

  return (
    <Card size="small" style={{ marginTop: 16 }}>
      {berichtigungZu && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Berichtigung zu #${berichtigungZu.lfd_nr}`}
          action={
            <Button size="small" onClick={onBerichtigungAbbrechen}>
              Abbrechen
            </Button>
          }
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ typ: 'meldung' }}
        onFinish={absenden}
        disabled={sendet}
      >
        <Space align="start" style={{ width: '100%' }}>
          {!berichtigungZu && (
            <Form.Item name="typ" style={{ marginBottom: 8, minWidth: 150 }}>
              <Select options={TYP_OPTIONEN} />
            </Form.Item>
          )}
          <Form.Item
            name="inhalt"
            style={{ flex: 1, marginBottom: 8, width: '100%' }}
            rules={[{ required: true, message: 'Inhalt ist Pflicht' }]}
          >
            <Input.TextArea placeholder="Inhalt …" autoSize={{ minRows: 1, maxRows: 4 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={sendet}>
            Erfassen
          </Button>
        </Space>

        <Collapse
          ghost
          items={[
            {
              key: 'optional',
              label: 'Weitere Angaben',
              children: (
                <Space wrap>
                  <Form.Item name="von" label="Von" style={{ marginBottom: 0 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="an" label="An" style={{ marginBottom: 0 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="meldeweg" label="Meldeweg" style={{ marginBottom: 0 }}>
                    <Select allowClear style={{ width: 140 }} options={MELDEWEG_OPTIONEN} />
                  </Form.Item>
                  <Form.Item name="veranlassung" label="Veranlassung" style={{ marginBottom: 0 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="ereigniszeit" label="Ereigniszeit" style={{ marginBottom: 0 }}>
                    <DatePicker showTime placeholder="abweichend …" />
                  </Form.Item>
                </Space>
              ),
            },
          ]}
        />
      </Form>
    </Card>
  );
}
