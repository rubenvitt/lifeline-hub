import { Form, Input } from 'antd';
import { Select } from '../../components/Select';
import AnlegenDrawer, { type AnlegenDrawerSlot } from '../../components/AnlegenDrawer';
import { legeUhsAn, type UhsEingabe } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import type { Uhs } from '../../api/types';
import { EinsatzOrtsfeld } from '../../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../../anzeige/Ortsfeld';
import { ortEingabe } from '../../anzeige/ortsfeldFormular';
import { uhsTyp } from '../../theme/statusFarben';

/** Formularwerte: der Standort ist ein Ortsfeld (Text und Koordinate, LLH-1114). */
type UhsFormular = Omit<UhsEingabe, 'standort' | 'lat' | 'lon'> & { standort?: OrtsfeldWert };

/** Formular → POST-Rumpf: Standort als Text, die Koordinate nur mit Text. */
function uhsEingabe({ standort, ...rest }: UhsFormular): UhsEingabe {
  const { text, lat, lon } = ortEingabe(standort);
  return {
    ...rest,
    ...(text != null ? { standort: text } : {}),
    ...(lat != null ? { lat, lon } : {}),
  };
}

/**
 * Wiederverwendbarer Drawer zum Anlegen einer UHS (Liste, Leerzustand, Switcher). Der Standort ist
 * ein Ortsfeld (LLH-1114, Spec `ortsfeld`): ein Treffer, eine getippte Koordinate oder ein Punkt auf
 * der Karte verortet die UHS gleich beim Anlegen.
 */
export default function UhsAnlegenDrawer(props: AnlegenDrawerSlot<Uhs>) {
  return (
    <AnlegenDrawer<Uhs, UhsFormular>
      {...props}
      titel="Unfallhilfsstelle anlegen"
      erfolgText="UHS angelegt"
      legeAn={(einsatzId, w) => legeUhsAn(einsatzId, uhsEingabe(w))}
      listenKey={einsatzKeys.uhs}
      initialValues={{ typ: 'behandlungsplatz' }}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}
      >
        <Input placeholder="z. B. BHP 50" />
      </Form.Item>
      <Form.Item label="Typ" name="typ" rules={[{ required: true }]}>
        <Select options={Object.entries(uhsTyp).map(([v, d]) => ({ value: v, label: d.label }))} />
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
