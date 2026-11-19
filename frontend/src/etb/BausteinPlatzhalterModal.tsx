// src/etb/BausteinPlatzhalterModal.tsx
import { Button, Form, Input, Modal } from 'antd';
import { useEffect } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { Feld, Stapel } from '../components/instrument';
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

export default function BausteinPlatzhalterModal({
  baustein,
  einsatz,
  onEinsetzen,
  onAbbrechenAll,
}: Props) {
  const [form] = Form.useForm<Record<string, string>>();
  // `{datum}`/`{uhrzeit}` in der Anzeigezone (LFH-692) und der wirksamen Darstellung (LLH-1061).
  const { konventionen } = useAnzeigeKonventionen();
  const offenePlatzhalter = baustein ? ermittlePlatzhalter(baustein, einsatz, konventionen) : [];

  // Bausteine ohne manuelle Platzhalter sofort einsetzen (kein Dialog nötig).
  useEffect(() => {
    if (!baustein) return;
    if (offenePlatzhalter.length === 0) {
      onEinsetzen(setzeBausteinEin(baustein, einsatz, {}, konventionen));
      return;
    }
    // Zurückgesetzt wird nur, wenn der Dialog aufgeht: antds `Modal` rendert sein
    // `<Form>` erst beim ersten Öffnen, und eine Formularinstanz ohne `<Form>`
    // anzufassen meldet rc-field-form als „not connected" (LFH-624).
    form.resetFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baustein]);

  function anwenden(werte: Record<string, string>) {
    if (!baustein) return;
    onEinsetzen(setzeBausteinEin(baustein, einsatz, werte, konventionen));
    form.resetFields();
  }

  function abbrechen() {
    form.resetFields();
    onAbbrechenAll();
  }

  const dialogOffen = baustein !== null && offenePlatzhalter.length > 0;

  return (
    <Modal
      open={dialogOffen}
      title="Baustein einsetzen"
      footer={null}
      onCancel={abbrechen}
      destroyOnHidden
    >
      <Form<Record<string, string>> form={form} layout="vertical" onFinish={anwenden}>
        <Stapel abstand="xs">
          {offenePlatzhalter.map((name, index) => (
            <Feld key={name} name={name} label={name}>
              <Input aria-label={name} autoFocus={index === 0} />
            </Feld>
          ))}
          {/* Eigene Hülle: im Stapel würde der Knopf sonst auf die ganze Breite gestreckt. */}
          <div>
            <Button type="primary" htmlType="submit">
              Einsetzen
            </Button>
          </div>
        </Stapel>
      </Form>
    </Modal>
  );
}
