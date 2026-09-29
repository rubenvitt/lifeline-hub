import { Form, Input } from 'antd';
import { useEffect, useRef } from 'react';
import { ErfassungsModal } from '../../components/Erfassung';
import type { GefahrBewertung } from '../../api/types';

interface Werte {
  beschreibung?: string;
  gemeldet_von?: string;
}

export interface GefahrenZelleDetailsProps {
  offen: boolean;
  /**
   * Stabile Kennung der gemeinten Zelle (`zellSchluessel`), `null` wenn keine gewählt ist. Sie —
   * nicht {@link GefahrenZelleDetailsProps.zelle} — entscheidet, wann das Formular neu belegt wird.
   */
  kennung: string | null;
  /**
   * Die bewertete Zelle, bei jedem Render frisch aus der Matrix abgeleitet (neue Identität bei
   * jedem Nachladen). `null`, solange keine gewählt ist.
   */
  zelle: GefahrBewertung | null;
  /** „Brand × Menschen" — steht im Dialogtitel. */
  titel: string;
  laeuft: boolean;
  onSpeichern: (beschreibung: string | null, gemeldetVon: string | null) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * Beschreibung und Meldeweg einer Matrixzelle auf `ErfassungsModal` (zwei Felder, Feldbudget Modal
 * ≤ ~3). Vorbelegen zum Bearbeiten ist kein Reset: `setFieldsValue` beim Öffnen macht der Effekt
 * unten, das Leeren übernimmt die Hülle auf jedem Weg hinaus.
 */
export default function GefahrenZelleDetails({
  offen,
  kennung,
  zelle,
  titel,
  laeuft,
  onSpeichern,
  onSchliessen,
}: GefahrenZelleDetailsProps) {
  const [form] = Form.useForm<Werte>();

  /**
   * Der Zellinhalt liegt in einer Ref, damit der Vorbeleg-Effekt ihn lesen kann, ohne von ihm
   * abzuhängen: hinge er an `zelle` (neue Identität bei jedem Nachladen), liefe er mitten im Tippen
   * los. Er hängt an der Öffnung und an {@link GefahrenZelleDetailsProps.kennung}.
   *
   * Die Ref zieht ein eigener Effekt nach, der vor dem Vorbeleg-Effekt steht — React arbeitet
   * Effekte in Deklarationsreihenfolge ab.
   */
  const zelleRef = useRef(zelle);
  useEffect(() => {
    zelleRef.current = zelle;
  }, [zelle]);

  useEffect(() => {
    if (!offen) return;
    const aktuell = zelleRef.current;
    form.setFieldsValue({
      beschreibung: aktuell?.beschreibung ?? '',
      gemeldet_von: aktuell?.gemeldet_von ?? '',
    });
  }, [offen, kennung, form]);

  return (
    <ErfassungsModal
      offen={offen}
      titel={`Details ${titel}`}
      form={form}
      laeuft={laeuft}
      erfassenText="Speichern"
      onErfassen={(w) =>
        onSpeichern(w.beschreibung?.trim() || null, w.gemeldet_von?.trim() || null)
      }
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item name="beschreibung" label="Beschreibung">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Form.Item name="gemeldet_von" label="Gemeldet von">
        <Input />
      </Form.Item>
    </ErfassungsModal>
  );
}
