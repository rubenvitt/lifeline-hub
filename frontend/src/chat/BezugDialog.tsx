import { Form } from 'antd';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import type { BezugTyp, ChatNachricht } from '../api/types';
import { BEZUG_TYP_OPTIONEN, type BezugOptionen } from './bezug';
import { Feld } from '../components/instrument';
import { pflicht } from '../components/pflichtRegel';

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
  /**
   * Die Speicher-Mutation (LFH-1077), an die Erfassungshülle durchgereicht: ihr Grund steht im
   * Dialog, bis zum nächsten Absenden; Öffnen und Abbrechen räumen ihn.
   */
  speicherung?: Speicherung;
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
  speicherung,
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
      speicherung={speicherung}
      speicherFehlerTitel="Bezug nicht gesetzt"
      // Die Pflichtregeln sichern beide Felder; der Typ von `FormWerte` kennt sie nur optional.
      onErfassen={(w) =>
        w.typ && w.ziel_id != null
          ? onBestaetigen(w.typ, w.ziel_id)
          : Promise.reject(new Error('Typ und Objekt fehlen'))
      }
      onFertig={onAbbrechen}
      onAbbrechen={onAbbrechen}
    >
      <Feld label="Typ" name="typ" rules={[pflicht('Typ')]}>
        <Select
          options={BEZUG_TYP_OPTIONEN}
          // Objekt-Auswahl bei Typ-Wechsel zurücksetzen (sie ist typ-spezifisch).
          onChange={() => form.setFieldsValue({ ziel_id: undefined })}
        />
      </Feld>
      {/* Ohne Typ gesperrt: das zeigt die Reihenfolge, kein Satz (LFH-1078). */}
      <Feld label="Objekt" name="ziel_id" rules={[pflicht('Objekt')]}>
        <Select options={objektOptionen} disabled={!typ} notFoundContent="Keine Objekte" />
      </Feld>
    </ErfassungsModal>
  );
}
