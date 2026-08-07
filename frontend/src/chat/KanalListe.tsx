import { Badge, Button, Form, Input, Modal, Typography } from 'antd';
import { useState } from 'react';
import type { ChatKanal } from '../api/types';
import { Liste, ListenEintrag } from '../components/Liste';
import { formatZeitKurz } from '../kommunikation';

interface Props {
  kanaele: ChatKanal[];
  aktiverKanalId: number | null;
  onWechsel: (kanalId: number) => void;
  darfSchreiben: boolean;
  onKanalAnlegen: (name: string, beschreibung?: string) => void;
}

interface KanalFormWerte {
  name: string;
  beschreibung?: string;
}

/** Ungelesene Kanäle zuerst, innerhalb beider Gruppen die jüngste Aktivität zuerst. */
export function sortiereKanaele(kanaele: ChatKanal[]): ChatKanal[] {
  return [...kanaele].sort((a, b) => {
    const ungelesen = Number(b.ungelesen_anzahl > 0) - Number(a.ungelesen_anzahl > 0);
    if (ungelesen !== 0) return ungelesen;
    return (b.letzte_nachricht_at ?? b.erstellt_at)
      .localeCompare(a.letzte_nachricht_at ?? a.erstellt_at);
  });
}

export default function KanalListe({
  kanaele, aktiverKanalId, onWechsel, darfSchreiben, onKanalAnlegen,
}: Props) {
  const [offen, setOffen] = useState(false);
  const [form] = Form.useForm<KanalFormWerte>();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Typography.Text strong>Kanäle</Typography.Text>
        {darfSchreiben && (
          <Button onClick={() => setOffen(true)}>Kanal</Button>
        )}
      </div>
      <Liste<ChatKanal>
        size="small"
        dataSource={sortiereKanaele(kanaele)}
        renderItem={(k) => (
          <ListenEintrag
            onClick={() => onWechsel(k.id)}
            style={{
              cursor: 'pointer',
              fontWeight: k.id === aktiverKanalId ? 600 : 400,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Badge dot={k.ungelesen_anzahl > 0} status="processing">
                <span>{k.name}</span>
              </Badge>
              {k.letzte_nachricht_at && (
                <Typography.Text type="secondary" title="Letzte Nachricht">
                  {formatZeitKurz(k.letzte_nachricht_at)}
                </Typography.Text>
              )}
            </div>
          </ListenEintrag>
        )}
      />
      <Modal
        open={offen}
        title="Neuer Kanal"
        okText="Anlegen"
        onOk={() => form.submit()}
        onCancel={() => setOffen(false)}
        destroyOnHidden
      >
        <Form<KanalFormWerte>
          form={form}
          layout="vertical"
          onFinish={(w) => {
            onKanalAnlegen(w.name.trim(), w.beschreibung?.trim() || undefined);
            form.resetFields();
            setOffen(false);
          }}
        >
          <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, message: 'Name erforderlich' }]}>
            <Input placeholder="z. B. S2/S3 oder Abschnitt Nord" />
          </Form.Item>
          <Form.Item label="Beschreibung (optional)" name="beschreibung">
            <Input placeholder="Kurzbeschreibung" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
