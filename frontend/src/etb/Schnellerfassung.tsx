import { Alert, Button, Card, Collapse, DatePicker, Form, Input, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NeuerEintrag } from '../api/etb';
import type { EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN, TYP_LABEL } from './typFarben';
import BausteinPicker from './BausteinPicker';
import MarkdownEditor from '../components/MarkdownEditor';

interface Props {
  erfassen: (eintrag: NeuerEintrag) => Promise<void>;
  /** Gesetzt = Berichtigungsmodus für diesen Originaleintrag. */
  berichtigungZu: EtbEintragAnzeige | null;
  onBerichtigungAbbrechen: () => void;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
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

export default function Schnellerfassung({ erfassen, berichtigungZu, onBerichtigungAbbrechen, bausteine, einsatz }: Props) {
  const [form] = Form.useForm<FormWerte>();
  const [sendet, setSendet] = useState(false);
  const navigate = useNavigate();
  const aktTyp = Form.useWatch('typ', form);

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
        {!berichtigungZu && bausteine.length > 0 && (
          <BausteinPicker form={form} bausteine={bausteine} einsatz={einsatz} />
        )}
        {/* Inhaltsfeld in voller Breite — der Schreiben/Vorschau-Tab-Umschalter des
            MarkdownEditors ist höher als eine einzelne Zeile, daher eigene Zeile. */}
        <Form.Item
          name="inhalt"
          style={{ marginBottom: 8 }}
          rules={[{ required: true, message: 'Inhalt ist Pflicht' }]}
        >
          <MarkdownEditor layout="tabs" variante="kompakt" placeholder="Inhalt …" autoSize={{ minRows: 1, maxRows: 4 }} />
        </Form.Item>
        {/* Typ-Select + Erfassen-Button in einer kompakten Zeile darunter */}
        <Space align="start" style={{ marginBottom: 0 }}>
          {!berichtigungZu && (
            <Form.Item name="typ" style={{ marginBottom: 8, minWidth: 150 }}>
              <Select options={TYP_OPTIONEN} />
            </Form.Item>
          )}
          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" loading={sendet}>
              Erfassen
            </Button>
          </Form.Item>
        </Space>

        {!berichtigungZu && aktTyp === 'lage' && (
          <Form.Item style={{ marginBottom: 8 }}>
            <Button
              type="link"
              style={{ paddingLeft: 0 }}
              onClick={() => navigate(`/einsaetze/${einsatz.id}/lageberichte`)}
            >
              Als strukturierten Lagebericht erfassen →
            </Button>
          </Form.Item>
        )}

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
