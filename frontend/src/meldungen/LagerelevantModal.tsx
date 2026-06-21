import { Alert, Button, Form, Input, Modal, Space, Typography } from 'antd';
import { useEffect } from 'react';
import type { Meldung } from '../api/types';
import KoordinatenEingabe from '../anzeige/KoordinatenEingabe';
import type { LatLon } from '../anzeige/koordinaten';

export interface LagerelevantDaten {
  text?: string;
  lat?: number;
  lon?: number;
}

interface Props {
  offen: boolean;
  meldung: Meldung | null;
  senden: boolean;
  einsatzId: number;
  onAbbrechen: () => void;
  onUebergeben: (d: LagerelevantDaten) => void;
}

interface FormWerte {
  text?: string;
  koord?: LatLon | null;
}

/**
 * An die Lage übergeben (LFH-95/113): optionaler Lage-Text + optionale Verortung (lat/lon).
 * Geo ist bewusst optional — ohne Koordinate landet die Meldung weiterhin nur als Listen-
 * Lageobjekt. Wird verortet, erscheint sie zusätzlich als Marker auf der Lagekarte.
 * KoordinatenEingabe liefert immer lat+lon gemeinsam oder null — kein Paar-Validator nötig.
 * Die Übergabe-Aktion ist einmalig (MeldungListe blendet sie danach aus).
 */
export default function LagerelevantModal({ offen, meldung, senden, einsatzId, onAbbrechen, onUebergeben }: Props) {
  const [form] = Form.useForm<FormWerte>();

  // Bei jedem Öffnen frisch: Text mit dem Meldungsinhalt vorbelegen, Koordinaten leer.
  useEffect(() => {
    if (offen) form.setFieldsValue({ text: meldung?.inhalt ?? '', koord: null });
  }, [offen, meldung, form]);

  function absenden(w: FormWerte) {
    const text = w.text?.trim() ? w.text.trim() : undefined;
    onUebergeben({ text, lat: w.koord?.lat, lon: w.koord?.lon });
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
      <Form<FormWerte> form={form} layout="vertical" onFinish={absenden}>
        <Form.Item name="text" label="Lage-Text">
          <Input.TextArea rows={3} placeholder="Kurzbeschreibung für die Lage" />
        </Form.Item>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Optional verorten — Koordinate setzt die Meldung als Marker auf die Lagekarte.
        </Typography.Text>
        <Form.Item name="koord" label="Verortung (optional)">
          <KoordinatenEingabe einsatzId={einsatzId} />
        </Form.Item>
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
