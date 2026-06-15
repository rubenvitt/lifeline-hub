import { App, Button, Card, DatePicker, Form, Input, InputNumber, Select, Space, Switch } from 'antd';
import { ThunderboltOutlined, SendOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import type { Meldungsart, MeldungMeldeweg, MeldungPrioritaet, NeueMeldung, Richtung } from '../api/types';

const { TextArea } = Input;

/** Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss'. */
function dayjsZuWire(d: dayjs.Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

export default function MeldungFormular({ senden, onAnlegen }: {
  senden: boolean;
  onAnlegen: (d: NeueMeldung) => void;
}) {
  const { message } = App.useApp();
  const [absender, setAbsender] = useState('');
  const [empfaenger, setEmpfaenger] = useState('');
  const [meldeweg, setMeldeweg] = useState<MeldungMeldeweg>('funk');
  const [meldungsart, setMeldungsart] = useState<Meldungsart>('sonstige');
  const [prioritaet, setPrioritaet] = useState<MeldungPrioritaet>('normal');
  const [richtung, setRichtung] = useState<Richtung>('intern');
  const [ereigniszeit, setEreigniszeit] = useState<dayjs.Dayjs | null>(null);
  const [inhalt, setInhalt] = useState('');
  const [bestaetigungPflicht, setBestaetigungPflicht] = useState(false);
  const [fristMin, setFristMin] = useState<number | null>(null);

  // Sofort (Art oder Priorität) ⇒ Bestätigungspflicht automatisch an (LFH-97). Der Nutzer
  // kann sie danach manuell wieder abwählen.
  const istSofort = meldungsart === 'sofortmeldung' || prioritaet === 'sofort';
  useEffect(() => {
    if (istSofort) setBestaetigungPflicht(true);
  }, [istSofort]);

  /** Fast-Path: Sofortmeldung vorbelegen (Art + Priorität sofort), Fokus auf den Wortlaut. */
  const sofortVorbelegen = () => {
    setMeldungsart('sofortmeldung');
    setPrioritaet('sofort');
    setBestaetigungPflicht(true);
  };

  /** Fast-Path: Lagemeldung an übergeordnete Führung (extern, LFH-87). */
  const lagemeldungVorbelegen = () => {
    setMeldungsart('lagemeldung');
    setRichtung('extern');
  };

  const absenden = () => {
    if (!absender.trim()) { message.error('Absender ist erforderlich'); return; }
    if (!inhalt.trim()) { message.error('Inhalt ist erforderlich'); return; }
    if (bestaetigungPflicht && fristMin != null && fristMin <= 0) {
      message.error('Bestätigungsfrist muss positiv sein'); return;
    }
    onAnlegen({
      absender: absender.trim(),
      empfaenger: empfaenger.trim() || undefined,
      meldeweg,
      inhalt: inhalt.trim(),
      meldungsart,
      prioritaet,
      richtung,
      // Ereigniszeit Pflicht: leer ⇒ jetzt (Funk-Realität: meist „eben empfangen").
      ereigniszeit: dayjsZuWire(ereigniszeit ?? dayjs()),
      bestaetigung_pflicht: bestaetigungPflicht,
      bestaetigung_frist_min: bestaetigungPflicht && fristMin != null ? fristMin : undefined,
    });
    setAbsender(''); setEmpfaenger(''); setMeldeweg('funk'); setMeldungsart('sonstige');
    setPrioritaet('normal'); setRichtung('intern'); setEreigniszeit(null); setInhalt('');
    setBestaetigungPflicht(false); setFristMin(null);
  };

  return (
    <Card
      size="small"
      title="Neue Meldung erfassen"
      extra={
        <Space>
          <Button danger size="small" icon={<ThunderboltOutlined />} onClick={sofortVorbelegen}>
            Sofortmeldung
          </Button>
          <Button size="small" icon={<SendOutlined />} onClick={lagemeldungVorbelegen}>
            Lagemeldung (extern)
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" onFinish={absenden}>
        <Form.Item label="Absender (Funkrufname/Stelle)" required>
          <Input aria-label="Absender" value={absender} onChange={(e) => setAbsender(e.target.value)} />
        </Form.Item>
        <Form.Item label="Empfänger / Adressat">
          <Input value={empfaenger} onChange={(e) => setEmpfaenger(e.target.value)} placeholder="z. B. ELW 1, S3" />
        </Form.Item>
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item label="Meldeweg" style={{ flex: 1 }}>
            <Select<MeldungMeldeweg> value={meldeweg} onChange={setMeldeweg} options={[
              { value: 'funk', label: 'Funk' },
              { value: 'telefon', label: 'Telefon' },
              { value: 'persoenlich', label: 'Persönlich' },
              { value: 'sonstige', label: 'Sonstige' },
            ]} />
          </Form.Item>
          <Form.Item label="Meldungsart" style={{ flex: 1 }}>
            <Select<Meldungsart> value={meldungsart} onChange={setMeldungsart} options={[
              { value: 'lagemeldung', label: 'Lagemeldung' },
              { value: 'sofortmeldung', label: 'Sofortmeldung' },
              { value: 'rueckmeldung', label: 'Rückmeldung' },
              { value: 'vollzugsmeldung', label: 'Vollzugsmeldung' },
              { value: 'anfrage', label: 'Anfrage' },
              { value: 'sonstige', label: 'Sonstige' },
            ]} />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item label="Priorität" style={{ flex: 1 }}>
            <Select<MeldungPrioritaet> value={prioritaet} onChange={setPrioritaet} options={[
              { value: 'sofort', label: 'Sofort' },
              { value: 'dringend', label: 'Dringend' },
              { value: 'normal', label: 'Normal' },
            ]} />
          </Form.Item>
          <Form.Item label="Richtung" style={{ flex: 1 }}>
            <Select<Richtung> aria-label="Richtung" value={richtung} onChange={setRichtung} options={[
              { value: 'intern', label: 'Intern' },
              { value: 'extern', label: 'Extern' },
            ]} />
          </Form.Item>
          <Form.Item label="Ereigniszeit (≠ Erfassung)" style={{ flex: 1 }}>
            <DatePicker showTime value={ereigniszeit} onChange={setEreigniszeit} style={{ width: '100%' }}
              format="YYYY-MM-DD HH:mm" placeholder="leer = jetzt" />
          </Form.Item>
        </div>
        <Form.Item label="Bestätigung erforderlich (Sofortmeldung)">
          <Space>
            <Switch
              checked={bestaetigungPflicht}
              onChange={setBestaetigungPflicht}
              aria-label="Bestätigung erforderlich"
            />
            {bestaetigungPflicht && (
              <InputNumber
                min={1}
                value={fristMin}
                onChange={(v) => setFristMin(v)}
                addonAfter="Min"
                placeholder="Frist (Default 5)"
                aria-label="Bestätigungsfrist in Minuten"
              />
            )}
          </Space>
        </Form.Item>
        <Form.Item label="Inhalt / Wortlaut" required>
          <TextArea aria-label="Inhalt / Wortlaut" value={inhalt} onChange={(e) => setInhalt(e.target.value)} rows={3} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={senden} block>Meldung erfassen</Button>
      </Form>
    </Card>
  );
}
