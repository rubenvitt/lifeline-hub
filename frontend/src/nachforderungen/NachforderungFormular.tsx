import { App, Button, Card, Form, Input, InputNumber, Select } from 'antd';
import { useState } from 'react';
import type { AdressatKategorie, NachforderungPrioritaet, NeueNachforderung } from '../api/types';

const { TextArea } = Input;

const ADRESSAT_OPTIONEN: { value: AdressatKategorie; label: string }[] = [
  { value: 'leitstelle', label: 'Leitstelle' },
  { value: 'nachbar_ea', label: 'Nachbar-Einsatzabschnitt' },
  { value: 'uebergeordnet', label: 'Übergeordnete Führung' },
  { value: 'andere_bos', label: 'Andere BOS' },
];

export default function NachforderungFormular({ senden, onAnlegen }: {
  senden: boolean;
  onAnlegen: (d: NeueNachforderung) => void;
}) {
  const { message } = App.useApp();
  const [art, setArt] = useState('');
  const [bezeichnung, setBezeichnung] = useState('');
  const [anzahl, setAnzahl] = useState<number | null>(null);
  const [adressatKategorie, setAdressatKategorie] = useState<AdressatKategorie>('leitstelle');
  const [adressatBezeichnung, setAdressatBezeichnung] = useState('');
  const [begruendung, setBegruendung] = useState('');
  const [prioritaet, setPrioritaet] = useState<NachforderungPrioritaet>('normal');

  const absenden = () => {
    if (!art.trim()) { message.error('Art ist erforderlich'); return; }
    if (!bezeichnung.trim()) { message.error('Bezeichnung ist erforderlich'); return; }
    if (anzahl != null && anzahl < 1) { message.error('Anzahl muss mindestens 1 sein'); return; }
    onAnlegen({
      art: art.trim(),
      bezeichnung: bezeichnung.trim(),
      anzahl: anzahl ?? undefined,
      adressat_kategorie: adressatKategorie,
      adressat_bezeichnung: adressatBezeichnung.trim() || undefined,
      begruendung: begruendung.trim() || undefined,
      prioritaet,
    });
    setArt(''); setBezeichnung(''); setAnzahl(null); setAdressatKategorie('leitstelle');
    setAdressatBezeichnung(''); setBegruendung(''); setPrioritaet('normal');
  };

  return (
    <Card size="small" title="Nachforderung absetzen">
      <Form layout="vertical" onFinish={absenden}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item label="Art (Kräfte/Mittel)" style={{ flex: 2 }} required>
            <Input aria-label="Art" value={art} onChange={(e) => setArt(e.target.value)} placeholder="z. B. RTW, SEG, Sandsäcke" />
          </Form.Item>
          <Form.Item label="Anzahl" style={{ flex: 1 }}>
            <InputNumber min={1} value={anzahl} onChange={(v) => setAnzahl(v)} style={{ width: '100%' }} aria-label="Anzahl" />
          </Form.Item>
        </div>
        <Form.Item label="Bezeichnung / Bedarf" required>
          <Input aria-label="Bezeichnung" value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} />
        </Form.Item>
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item label="Adressat" style={{ flex: 1 }}>
            <Select<AdressatKategorie> aria-label="Adressat" value={adressatKategorie} onChange={setAdressatKategorie} options={ADRESSAT_OPTIONEN} />
          </Form.Item>
          <Form.Item label="Adressat-Bezeichnung" style={{ flex: 1 }}>
            <Input value={adressatBezeichnung} onChange={(e) => setAdressatBezeichnung(e.target.value)} placeholder="z. B. Leitstelle Nord" />
          </Form.Item>
        </div>
        <Form.Item label="Priorität">
          <Select<NachforderungPrioritaet> value={prioritaet} onChange={setPrioritaet} options={[
            { value: 'sofort', label: 'Sofort' },
            { value: 'dringend', label: 'Dringend' },
            { value: 'normal', label: 'Normal' },
          ]} />
        </Form.Item>
        <Form.Item label="Begründung / Lagebezug">
          <TextArea value={begruendung} onChange={(e) => setBegruendung(e.target.value)} rows={2} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={senden} block>Nachforderung absetzen</Button>
      </Form>
    </Card>
  );
}
