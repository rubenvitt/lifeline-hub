import { Button, Card, Col, Form, Input, InputNumber, Row, Select } from 'antd';
import type { AdressatKategorie, NachforderungPrioritaet, NeueNachforderung } from '../api/types';

const { TextArea } = Input;

const ADRESSAT_OPTIONEN: { value: AdressatKategorie; label: string }[] = [
  { value: 'leitstelle', label: 'Leitstelle' },
  { value: 'nachbar_ea', label: 'Nachbar-Einsatzabschnitt' },
  { value: 'uebergeordnet', label: 'Übergeordnete Führung' },
  { value: 'andere_bos', label: 'Andere BOS' },
];

/** Werte des Formulars (entsprechen den Eingabefeldern). */
interface FormWerte {
  art: string;
  anzahl: number | null;
  bezeichnung: string;
  adressatKategorie: AdressatKategorie;
  adressatBezeichnung: string;
  prioritaet: NachforderungPrioritaet;
  begruendung: string;
}

export default function NachforderungFormular({ senden, onAnlegen, card = true }: {
  senden: boolean;
  onAnlegen: (d: NeueNachforderung) => void;
  /** Umschließende Card mit Titel rendern. `false` für Inline-Einbettung, wo der
   *  Container den Titel schon liefert (vermeidet doppelte Überschrift, LFH-112). */
  card?: boolean;
}) {
  const [form] = Form.useForm<FormWerte>();

  const onFinish = (w: FormWerte) => {
    onAnlegen({
      art: w.art.trim(),
      bezeichnung: w.bezeichnung.trim(),
      anzahl: w.anzahl ?? undefined,
      adressat_kategorie: w.adressatKategorie,
      adressat_bezeichnung: w.adressatBezeichnung?.trim() || undefined,
      begruendung: w.begruendung?.trim() || undefined,
      prioritaet: w.prioritaet,
    });
    form.resetFields();
  };

  const formular = (
    <Form<FormWerte>
      form={form}
      layout="vertical"
      onFinish={onFinish}
      initialValues={{
        art: '', anzahl: null, bezeichnung: '', adressatKategorie: 'leitstelle',
        adressatBezeichnung: '', prioritaet: 'normal', begruendung: '',
      }}
    >
      <Row gutter={16}>
        <Col xs={24} sm={16}>
          <Form.Item
            name="art"
            label="Art (Kräfte/Mittel)"
            rules={[{ required: true, whitespace: true, message: 'Art ist erforderlich' }]}
          >
            <Input aria-label="Art" placeholder="z. B. RTW, SEG, Sandsäcke" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="anzahl" label="Anzahl">
            <InputNumber min={1} style={{ width: '100%' }} aria-label="Anzahl" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item
        name="bezeichnung"
        label="Bezeichnung / Bedarf"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung ist erforderlich' }]}
      >
        <Input aria-label="Bezeichnung" />
      </Form.Item>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="adressatKategorie" label="Adressat">
            <Select<AdressatKategorie> aria-label="Adressat" options={ADRESSAT_OPTIONEN} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="adressatBezeichnung" label="Adressat-Bezeichnung">
            <Input placeholder="z. B. Leitstelle Nord" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="prioritaet" label="Priorität">
            <Select<NachforderungPrioritaet> options={[
              { value: 'sofort', label: 'Sofort' },
              { value: 'dringend', label: 'Dringend' },
              { value: 'normal', label: 'Normal' },
            ]} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="begruendung" label="Begründung / Lagebezug">
            <TextArea rows={1} />
          </Form.Item>
        </Col>
      </Row>
      <Button type="primary" htmlType="submit" loading={senden} block>Nachforderung absetzen</Button>
    </Form>
  );

  if (!card) return formular;
  return <Card size="small" title="Nachforderung absetzen">{formular}</Card>;
}
