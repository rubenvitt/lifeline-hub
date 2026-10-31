import { Form, Input } from 'antd';
import { BR_BEZEICHNUNG_MAX, BR_NOTIZ_MAX, BR_STANDORT_MAX } from '../../api/eingabegrenzen';
import { ortZeichenRegel, zeichenGrenze, zeichenRegel } from '../../components/zeichenGrenze';
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
        rules={[
          { required: true, message: 'Bezeichnung erforderlich' },
          zeichenRegel(BR_BEZEICHNUNG_MAX, 'Bezeichnung'),
        ]}
      >
        <Input placeholder="z. B. BR Ost" count={zeichenGrenze(BR_BEZEICHNUNG_MAX)} />
      </Form.Item>
      <Form.Item
        label="Standort (optional)"
        name="standort"
        rules={[ortZeichenRegel(BR_STANDORT_MAX, 'Standort')]}
      >
        <EinsatzOrtsfeld
          einsatzId={props.einsatzId}
          etikett="Standort"
          count={zeichenGrenze(BR_STANDORT_MAX)}
        />
      </Form.Item>
      <Form.Item
        label="Notiz (optional)"
        name="notiz"
        rules={[zeichenRegel(BR_NOTIZ_MAX, 'Notiz')]}
      >
        <Input.TextArea rows={3} count={zeichenGrenze(BR_NOTIZ_MAX)} />
      </Form.Item>
    </AnlegenDrawer>
  );
}
