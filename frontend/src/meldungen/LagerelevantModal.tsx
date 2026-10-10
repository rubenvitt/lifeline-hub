import { Button, Form, Input, Modal, Space } from 'antd';
import { useCallback, useEffect, useRef } from 'react';
import type { Speicherung } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
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
  /**
   * Die Übergabe-Mutation (LFH-1077): ihr Fehler steht im Dialog, bis zum nächsten Übergeben;
   * Öffnen und Abbrechen räumen ihn. Solange sie läuft, ist jeder Ausweg gesperrt.
   */
  speicherung?: Speicherung;
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
  speicherung,
}: Props) {
  const [form] = Form.useForm<FormWerte>();
  const sperrt = speicherung?.isPending === true;
  // Ref, damit das Öffnen die AKTUELLE Mutation räumt, ohne je Render neu zu laufen.
  const speicherungRef = useRef(speicherung);
  speicherungRef.current = speicherung;
  const raeume = useCallback(() => {
    const s = speicherungRef.current;
    if (s && !s.isPending && s.error != null) s.reset();
  }, []);

  // Bei jedem Öffnen frisch: Text mit dem Meldungsinhalt vorbelegen, Koordinaten leer, kein Grund.
  useEffect(() => {
    if (!offen) return;
    form.setFieldsValue({ text: meldung?.inhalt ?? '', koord: null });
    raeume();
  }, [offen, meldung, form, raeume]);

  const abbrechen = () => {
    if (sperrt) return;
    raeume();
    onAbbrechen();
  };

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
      onCancel={abbrechen}
      closable={sperrt ? { disabled: true } : true}
      mask={{ closable: !sperrt }}
      keyboard={!sperrt}
      destroyOnHidden
      width={460}
    >
      <Form<FormWerte> form={form} layout="vertical" onFinish={absenden}>
        <Form.Item name="text" label="Lage-Text">
          <Input.TextArea rows={3} placeholder="Kurzbeschreibung für die Lage" />
        </Form.Item>
        {/* Die Folge sichtbar am Feld (LFH-1078): verortet wird nur hier, die Karte ändert es nicht. */}
        <KoordinatenFeld
          name="koord"
          label="Verortung (optional)"
          extra="Später nicht änderbar"
          einsatzId={einsatzId}
        />
        {speicherung?.error != null && (
          <div style={{ marginBottom: 12 }}>
            <SpeicherFehler fehler={speicherung.error} titel="Nicht übergeben" />
          </div>
        )}
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={abbrechen} disabled={sperrt}>
            Abbrechen
          </Button>
          <Button type="primary" htmlType="submit" loading={senden}>
            Übergeben
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
