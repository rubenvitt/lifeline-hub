import { Form, Input } from 'antd';
import AnlegenDrawer, { type AnlegenDrawerSlot } from '../../components/AnlegenDrawer';
import { legeBrAn, type BrEingabe } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum } from '../../api/types';
import { EinsatzOrtsfeld } from '../../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../../anzeige/Ortsfeld';
import { ortEingabe } from '../../anzeige/ortsfeldFormular';

/** Formularwerte: der Standort ist ein Ortsfeld (Text und Koordinate, LLH-1114). */
type BrFormular = Omit<BrEingabe, 'standort' | 'lat' | 'lon'> & { standort?: OrtsfeldWert };

/** Formular → POST-Rumpf: Standort als Text, die Koordinate nur mit Text. */
function brEingabe({ standort, ...rest }: BrFormular): BrEingabe {
  const { text, lat, lon } = ortEingabe(standort);
  return {
    ...rest,
    ...(text != null ? { standort: text } : {}),
    ...(lat != null ? { lat, lon } : {}),
  };
}

/**
 * Wiederverwendbarer Drawer zum Anlegen eines Bereitstellungsraums (Liste, Leerzustand, Switcher).
 * Der Standort ist ein Ortsfeld (LLH-1114, Spec `ortsfeld`) und verortet den Raum gleich mit.
 */
export default function BrAnlegenDrawer(props: AnlegenDrawerSlot<Bereitstellungsraum>) {
  return (
    <AnlegenDrawer<Bereitstellungsraum, BrFormular>
      {...props}
      titel="Bereitstellungsraum anlegen"
      erfolgText="Bereitstellungsraum angelegt"
      legeAn={(einsatzId, w) => legeBrAn(einsatzId, brEingabe(w))}
      listenKey={einsatzKeys.br}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}
      >
        <Input placeholder="z. B. BR Ost" />
      </Form.Item>
      <Form.Item label="Standort (optional)" name="standort">
        <EinsatzOrtsfeld einsatzId={props.einsatzId} etikett="Standort" />
      </Form.Item>
      <Form.Item label="Notiz (optional)" name="notiz">
        <Input.TextArea rows={3} />
      </Form.Item>
    </AnlegenDrawer>
  );
}
