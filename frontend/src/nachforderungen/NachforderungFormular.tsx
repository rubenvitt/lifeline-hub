import { Button, Card, Form, Input, InputNumber, Select } from 'antd';
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

export default function NachforderungFormular({ senden, onAnlegen }: {
  senden: boolean;
  onAnlegen: (d: NeueNachforderung) => void;
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

  return (
    <Card size="small" title="Nachforderung absetzen">
      <Form<FormWerte>
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          art: '', anzahl: null, bezeichnung: '', adressatKategorie: 'leitstelle',
          adressatBezeichnung: '', prioritaet: 'normal', begruendung: '',
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item
            name="art"
            label="Art (Kräfte/Mittel)"
            style={{ flex: 2 }}
            rules={[{ required: true, whitespace: true, message: 'Art ist erforderlich' }]}
          >
            <Input aria-label="Art" placeholder="z. B. RTW, SEG, Sandsäcke" />
          </Form.Item>
          <Form.Item name="anzahl" label="Anzahl" style={{ flex: 1 }}>
            <InputNumber min={1} style={{ width: '100%' }} aria-label="Anzahl" />
          </Form.Item>
        </div>
        <Form.Item
          name="bezeichnung"
          label="Bezeichnung / Bedarf"
          rules={[{ required: true, whitespace: true, message: 'Bezeichnung ist erforderlich' }]}
        >
          <Input aria-label="Bezeichnung" />
        </Form.Item>
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item name="adressatKategorie" label="Adressat" style={{ flex: 1 }}>
            <Select<AdressatKategorie> aria-label="Adressat" options={ADRESSAT_OPTIONEN} />
          </Form.Item>
          <Form.Item name="adressatBezeichnung" label="Adressat-Bezeichnung" style={{ flex: 1 }}>
            <Input placeholder="z. B. Leitstelle Nord" />
          </Form.Item>
        </div>
        <Form.Item name="prioritaet" label="Priorität">
          <Select<NachforderungPrioritaet> options={[
            { value: 'sofort', label: 'Sofort' },
            { value: 'dringend', label: 'Dringend' },
            { value: 'normal', label: 'Normal' },
          ]} />
        </Form.Item>
        <Form.Item name="begruendung" label="Begründung / Lagebezug">
          <TextArea rows={2} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={senden} block>Nachforderung absetzen</Button>
      </Form>
    </Card>
  );
}
