import { Alert, Button, Form, Input, InputNumber, Modal, Space, Typography } from 'antd';
import { useEffect } from 'react';
import type { Meldung } from '../api/types';

export interface LagerelevantDaten {
  text?: string;
  lat?: number;
  lon?: number;
}

interface Props {
  offen: boolean;
  meldung: Meldung | null;
  senden: boolean;
  onAbbrechen: () => void;
  onUebergeben: (d: LagerelevantDaten) => void;
}

interface FormWerte {
  text?: string;
  lat?: number | null;
  lon?: number | null;
}

/**
 * An die Lage übergeben (LFH-95/113): optionaler Lage-Text + optionale Verortung (lat/lon).
 * Geo ist bewusst optional — ohne Koordinate landet die Meldung weiterhin nur als Listen-
 * Lageobjekt. Wird verortet, erscheint sie zusätzlich als Marker auf der Lagekarte. lat/lon
 * nur gemeinsam (Backend-Validierung, deshalb vorab geprüft). Die Übergabe-Aktion ist einmalig
 * (MeldungListe blendet sie danach aus) → es entsteht stets ein frischer INSERT mit Geo.
 */
export default function LagerelevantModal({ offen, meldung, senden, onAbbrechen, onUebergeben }: Props) {
  const [form] = Form.useForm<FormWerte>();

  // Bei jedem Öffnen frisch: Text mit dem Meldungsinhalt vorbelegen, Koordinaten leer.
  useEffect(() => {
    if (offen) form.setFieldsValue({ text: meldung?.inhalt ?? '', lat: null, lon: null });
  }, [offen, meldung, form]);

  function absenden(w: FormWerte) {
    const hatLat = w.lat != null;
    const hatLon = w.lon != null;
    const text = w.text?.trim() ? w.text.trim() : undefined;
    onUebergeben({
      text,
      lat: hatLat ? (w.lat as number) : undefined,
      lon: hatLon ? (w.lon as number) : undefined,
    });
  }

  return (
    <Modal
      open={offen}
      title="An die Lage übergeben"
      footer={null}
      onCancel={onAbbrechen}
      destroyOnHidden
      width={460}
    >
      {/* lat/lon nur gemeinsam (Validator unten) — sonst weist das Backend (422) ab. */}
      <Form<FormWerte> form={form} layout="vertical" onFinish={absenden}>
        <Form.Item name="text" label="Lage-Text">
          <Input.TextArea rows={3} placeholder="Kurzbeschreibung für die Lage" />
        </Form.Item>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Optional verorten — Koordinate setzt die Meldung als Marker auf die Lagekarte.
        </Typography.Text>
        <Space>
          <Form.Item
            name="lat"
            label="Breitengrad (Lat)"
            dependencies={['lon']}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const lon = getFieldValue('lon');
                  if ((value == null) !== (lon == null)) {
                    return Promise.reject(new Error('Lat und Lon nur gemeinsam'));
                  }
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <InputNumber style={{ width: 140 }} aria-label="Breitengrad" placeholder="z. B. 50.1" />
          </Form.Item>
          <Form.Item name="lon" label="Längengrad (Lon)" dependencies={['lat']}>
            <InputNumber style={{ width: 140 }} aria-label="Längengrad" placeholder="z. B. 8.6" />
          </Form.Item>
        </Space>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Die Verortung kann nur beim Übergeben gesetzt werden."
        />
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={onAbbrechen}>Abbrechen</Button>
          <Button type="primary" htmlType="submit" loading={senden}>
            Übergeben
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
