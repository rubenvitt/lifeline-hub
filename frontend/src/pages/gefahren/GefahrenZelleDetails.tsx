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
   * Stabile Kennung der gemeinten Zelle (`zellSchluessel`), `null` wenn keine gewählt
   * ist. Sie — nicht {@link GefahrenZelleDetailsProps.zelle} — entscheidet, wann das
   * Formular neu belegt wird.
   */
  kennung: string | null;
  /** Die bewertete Zelle, bei jedem Render frisch aus der Matrix abgeleitet. `null`,
   *  solange keine gewählt ist. Die Objektidentität wechselt also bei jedem Nachladen. */
  zelle: GefahrBewertung | null;
  /** „Brand × Menschen" — steht im Dialogtitel. */
  titel: string;
  laeuft: boolean;
  onSpeichern: (beschreibung: string | null, gemeldetVon: string | null) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * Beschreibung und Meldeweg einer Matrixzelle. Nimmt `ErfassungsModal` statt eines
 * handgebauten `<Modal>` + `<Form>` (Erfassungs-Norm LFH-332/B4) — vorher war das ein
 * `Popover` mit einem Knopf AUSSERHALB des Formulars, in dem Enter tot war.
 *
 * Zwei Felder, damit das Feldbudget (Modal ≤ ~3, LFH-19) eingehalten ist.
 *
 * Vorbelegen zum Bearbeiten ist ausdrücklich kein Reset (Norm B4): `setFieldsValue`
 * beim Öffnen bleibt Aufgabe des Aufrufers, das Leeren übernimmt die Hülle — auf
 * jedem Weg hinaus, auch über Escape und den Klick auf die Maske.
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
   * Der Zellinhalt liegt in einer Ref, damit der Vorbeleg-Effekt ihn LESEN kann,
   * ohne von ihm ABZUHÄNGEN.
   *
   * Der Aufrufer leitet `zelle` bei jedem Render frisch aus der Matrix ab — jedes
   * Nachladen liefert also eine neue Objektidentität, auch wenn sich nichts geändert
   * hat. Hinge der Effekt an `zelle`, liefe er dann mitten im Tippen los und
   * überschriebe den Wortlaut mit dem Serverstand. Der Effekt hängt deshalb an der
   * ÖFFNUNG und an der stabilen {@link GefahrenZelleDetailsProps.kennung}: eine andere
   * Zelle belegt neu, dieselbe Zelle in frischer Fassung nicht.
   *
   * Die Ref wird in einem eigenen Effekt nachgezogen, nicht im Renderdurchgang.
   * Er steht VOR dem Vorbeleg-Effekt, weil React sie in Deklarationsreihenfolge
   * abarbeitet — beim Öffnen liest der zweite also bereits den aktuellen Wert.
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
