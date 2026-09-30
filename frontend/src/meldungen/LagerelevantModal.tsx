import { Alert, Button, Form, Input, Modal, Space, Typography } from 'antd';
import { useEffect } from 'react';
import type { Meldung } from '../api/types';
import KoordinatenFeld from '../anzeige/KoordinatenFeld';
import { alsLatLon, type KoordinatenWert } from '../anzeige/koordinatenWert';

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
  koord?: KoordinatenWert;
}

/**
 * An die Lage übergeben: optionaler Lage-Text und optionale Verortung. Ohne Koordinate bleibt
 * die Meldung ein Listen-Lageobjekt, verortet erscheint sie zusätzlich als Marker. Die Aktion
 * ist einmalig (MeldungListe blendet sie danach aus).
 */
export default function LagerelevantModal({
  offen,
  meldung,
  senden,
  einsatzId,
  onAbbrechen,
  onUebergeben,
}: Props) {
  const [form] = Form.useForm<FormWerte>();

  // Bei jedem Öffnen frisch: Text mit dem Meldungsinhalt vorbelegen, Koordinaten leer.
  useEffect(() => {
    if (offen) form.setFieldsValue({ text: meldung?.inhalt ?? '', koord: null });
  }, [offen, meldung, form]);

  function absenden(w: FormWerte) {
    const text = w.text?.trim() ? w.text.trim() : undefined;
    const koord = alsLatLon(w.koord);
    onUebergeben({ text, lat: koord?.lat, lon: koord?.lon });
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
        <KoordinatenFeld name="koord" label="Verortung (optional)" einsatzId={einsatzId} />
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="Die Verortung kann nur beim Übergeben gesetzt werden."
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
