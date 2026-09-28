import { Form, Input } from 'antd';
import { Select } from '../../components/Select';
import AnlegenDrawer, { type AnlegenDrawerSlot } from '../../components/AnlegenDrawer';
import { legeUhsAn, type UhsEingabe } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import type { Uhs } from '../../api/types';
import { uhsTyp } from '../../theme/statusFarben';

/** Wiederverwendbarer Drawer zum Anlegen einer UHS (Liste, Leerzustand, Switcher). */
export default function UhsAnlegenDrawer(props: AnlegenDrawerSlot<Uhs>) {
  return (
    <AnlegenDrawer<Uhs, UhsEingabe>
      {...props}
      titel="Unfallhilfsstelle anlegen"
      erfolgText="UHS angelegt"
      legeAn={legeUhsAn}
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
        <Input placeholder="Adresse / Hinweis" />
      </Form.Item>
      <Form.Item label="Notiz (optional)" name="notiz">
        <Input.TextArea rows={3} />
      </Form.Item>
    </AnlegenDrawer>
  );
}
