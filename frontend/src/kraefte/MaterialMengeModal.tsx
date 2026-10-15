import { Form } from 'antd';
import { useEffect, useRef } from 'react';
import type { EinsatzMaterial } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';

interface Werte {
  menge?: number;
}

type Posten = Pick<EinsatzMaterial, 'id' | 'bezeichnung' | 'menge' | 'ausgegeben'>;

export interface MaterialMengeModalProps {
  /** Das Verbrauchsgut; `null` = zu. */
  posten: Posten | null;
  laeuft: boolean;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`); unverändert ruft der Dialog nichts. */
  onSpeichern: (menge: number) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * „Menge ändern …“ eines Verbrauchsguts (LLH-1225, design.md D5): die Gesamtmenge, nicht unter die
 * Ausgabe und nie unter 1 (wie der Server, LLH-1224 D4). Ersetzt 1093s Inline-Menge in der Zelle;
 * die Zelle trägt dafür „Ausgeben“. Gesendet wird nur mit Enter oder „Speichern“.
 */
export default function MaterialMengeModal({
  posten,
  laeuft,
  speicherung,
  onSpeichern,
  onSchliessen,
}: MaterialMengeModalProps) {
  const [form] = Form.useForm<Werte>();
  // Der Posten in einer Ref (Muster `MaterialAngabenModal`): das Nachladen der Liste überschriebe
  // sonst mitten im Tippen.
  const postenRef = useRef(posten);
  useEffect(() => {
    postenRef.current = posten;
  }, [posten]);
  const offenId = posten?.id ?? null;
  useEffect(() => {
    const p = postenRef.current;
    if (offenId == null || !p) return;
    form.setFieldsValue({ menge: p.menge });
  }, [offenId, form]);
  const mindestens = Math.max(1, posten?.ausgegeben ?? 0);
  return (
    <ErfassungsModal<Werte>
      offen={posten != null}
      titel={posten ? `Menge von ${posten.bezeichnung} ändern` : undefined}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht gespeichert"
      speicherFehlerFallback="Speichern fehlgeschlagen"
      onErfassen={async (w) => {
        const vorher = postenRef.current;
        if (vorher && w.menge != null && w.menge !== vorher.menge) await onSpeichern(w.menge);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Menge"
        name="menge"
        rules={[
          { required: true, message: 'Menge eintragen' },
          {
            validator: (_, n: number | undefined) =>
              n == null || n >= mindestens
                ? Promise.resolve()
                : Promise.reject(new Error(`mindestens ${mindestens}`)),
          },
        ]}
      >
        <MengenFeld beschriftung="Menge" style={{ width: 120 }} />
      </Form.Item>
    </ErfassungsModal>
  );
}
