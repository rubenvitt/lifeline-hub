import { Form } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { ErfassungsModal } from '../components/Erfassung';
import type { BezugTyp, ChatNachricht } from '../api/types';
import { BEZUG_TYP_OPTIONEN, type BezugOptionen } from './bezug';

interface FormWerte {
  typ?: BezugTyp;
  ziel_id?: number;
}

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  /** Wählbare Objekte je Typ (aus den Listen-Queries der ChatPage). */
  optionen: BezugOptionen;
  senden: boolean;
  onAbbrechen: () => void;
  /** Speichern. Muss bei Ablehnung ablehnen (`mutateAsync`), sonst leert die Hülle. */
  onBestaetigen: (typ: BezugTyp, zielId: number) => Promise<unknown>;
}

/** Dialog zum nachträglichen Setzen/Ändern des polymorphen Sachbezugs: Typ wählen, dann ein
    Objekt dieses Typs. Auf der Erfassungshülle (`frontend/AGENTS.md`, Erfassungs-Norm). */
export default function BezugDialog({
  offen,
  nachricht,
  optionen,
  senden,
  onAbbrechen,
  onBestaetigen,
}: Props) {
  const [form] = Form.useForm<FormWerte>();
  const typ = Form.useWatch('typ', form);

  // VORBELEGUNG beim Öffnen (Ändern-Fall), kein Zurücksetzen: das tut die Hülle auf jedem Weg
  // hinaus.
  useEffect(() => {
    if (offen) {
      form.setFieldsValue({
        typ: nachricht?.bezug_typ ?? undefined,
        ziel_id: nachricht?.bezug_id ?? undefined,
      });
    }
  }, [offen, nachricht, form]);

  const objektOptionen = typ ? optionen[typ] : [];

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="Bezug setzen"
      form={form}
      erfassenText="Speichern"
      laeuft={senden}
      // Die Pflichtregeln sichern beide Felder; der Typ von `FormWerte` kennt sie nur optional.
      onErfassen={(w) =>
        w.typ && w.ziel_id != null
          ? onBestaetigen(w.typ, w.ziel_id)
          : Promise.reject(new Error('Typ und Objekt fehlen'))
      }
      onFertig={onAbbrechen}
      onAbbrechen={onAbbrechen}
    >
      <Form.Item label="Typ" name="typ" rules={[{ required: true, message: 'Typ wählen' }]}>
        <Select
          options={BEZUG_TYP_OPTIONEN}
          // Objekt-Auswahl bei Typ-Wechsel zurücksetzen (sie ist typ-spezifisch).
          onChange={() => form.setFieldsValue({ ziel_id: undefined })}
        />
      </Form.Item>
      <Form.Item
        label="Objekt"
        name="ziel_id"
        rules={[{ required: true, message: 'Objekt wählen' }]}
      >
        <Select
          options={objektOptionen}
          disabled={!typ}
          notFoundContent={typ ? 'Keine Objekte' : 'Zuerst Typ wählen'}
        />
      </Form.Item>
    </ErfassungsModal>
  );
}
