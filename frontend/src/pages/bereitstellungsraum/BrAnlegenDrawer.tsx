import { Form, Input } from 'antd';
import AnlegenDrawer, { type AnlegenDrawerSlot } from '../../components/AnlegenDrawer';
import { legeBrAn, type BrEingabe } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum } from '../../api/types';

/** Wiederverwendbarer Drawer zum Anlegen eines Bereitstellungsraums (Liste, Leerzustand, Switcher). */
export default function BrAnlegenDrawer(props: AnlegenDrawerSlot<Bereitstellungsraum>) {
  return (
    <AnlegenDrawer<Bereitstellungsraum, BrEingabe>
      {...props}
      titel="Bereitstellungsraum anlegen"
      erfolgText="Bereitstellungsraum angelegt"
      legeAn={legeBrAn}
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
        <Input placeholder="Adresse / Hinweis" />
      </Form.Item>
      <Form.Item label="Notiz (optional)" name="notiz">
        <Input.TextArea rows={3} />
      </Form.Item>
    </AnlegenDrawer>
  );
}
