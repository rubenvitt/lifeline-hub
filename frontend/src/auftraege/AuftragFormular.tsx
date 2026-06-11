import { App, Button, Card, DatePicker, Form, Input, Select } from 'antd';
import { useState } from 'react';
import dayjs from 'dayjs';
import type { AuftragPrioritaet, NeuerAuftrag, NeuerEmpfaenger } from '../api/types';

const { TextArea } = Input;

/** Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss'. */
function dayjsZuWire(d: dayjs.Dayjs | null): string | undefined {
  return d ? d.utc().format('YYYY-MM-DD HH:mm:ss') : undefined;
}

export default function AuftragFormular({ senden, onAnlegen }: {
  senden: boolean;
  onAnlegen: (d: NeuerAuftrag) => void;
}) {
  const { message } = App.useApp();
  const [text, setText] = useState('');
  const [absicht, setAbsicht] = useState('');
  const [lage, setLage] = useState('');
  const [ort, setOrt] = useState('');
  const [mittel, setMittel] = useState('');
  const [verbindung, setVerbindung] = useState('');
  const [sicherheit, setSicherheit] = useState('');
  const [prioritaet, setPrioritaet] = useState<AuftragPrioritaet>('normal');
  const [frist, setFrist] = useState<dayjs.Dayjs | null>(null);
  const [empfText, setEmpfText] = useState('');

  const absenden = () => {
    if (!text.trim()) { message.error('Auftragstext ist erforderlich'); return; }
    if (!empfText.trim()) { message.error('Mindestens ein Empfänger ist erforderlich'); return; }
    // MVP: Empfänger als Funktion (Freitext); strukturierte EA-/Einheit-Auswahl folgt.
    const empfaenger: NeuerEmpfaenger[] = empfText
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map((funktion_text) => ({ empfaenger_typ: 'funktion', funktion_text }));
    onAnlegen({
      auftrag_text: text.trim(),
      absicht: absicht.trim() || undefined,
      lage: lage.trim() || undefined,
      ort: ort.trim() || undefined,
      mittel: mittel.trim() || undefined,
      verbindung: verbindung.trim() || undefined,
      sicherheit: sicherheit.trim() || undefined,
      prioritaet,
      frist_at: dayjsZuWire(frist),
      empfaenger,
    });
    setText(''); setAbsicht(''); setLage(''); setOrt(''); setMittel('');
    setVerbindung(''); setSicherheit(''); setFrist(null); setEmpfText('');
  };

  return (
    <Card size="small" title="Neuer Auftrag/Befehl">
      <Form layout="vertical" onFinish={absenden}>
        <Form.Item label="Empfänger (EA/Einheit/Funktion, kommagetrennt)" required>
          <Input value={empfText} onChange={(e) => setEmpfText(e.target.value)} placeholder="Abschnitt Nord, 2. Zug" />
        </Form.Item>
        <Form.Item label="Auftrag / Was" required>
          <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={2} />
        </Form.Item>
        <Form.Item label="Absicht / Ziel">
          <TextArea value={absicht} onChange={(e) => setAbsicht(e.target.value)} rows={1} />
        </Form.Item>
        <Form.Item label="Lage">
          <TextArea value={lage} onChange={(e) => setLage(e.target.value)} rows={1} />
        </Form.Item>
        <Form.Item label="Ort / Wo">
          <Input value={ort} onChange={(e) => setOrt(e.target.value)} />
        </Form.Item>
        <Form.Item label="Mittel / Womit">
          <Input value={mittel} onChange={(e) => setMittel(e.target.value)} />
        </Form.Item>
        <Form.Item label="Verbindung / Meldewege">
          <Input value={verbindung} onChange={(e) => setVerbindung(e.target.value)} />
        </Form.Item>
        <Form.Item label="Sicherheit / Besonderes">
          <Input value={sicherheit} onChange={(e) => setSicherheit(e.target.value)} />
        </Form.Item>
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item label="Priorität" style={{ flex: 1 }}>
            <Select<AuftragPrioritaet> value={prioritaet} onChange={setPrioritaet} options={[
              { value: 'sofort', label: 'Sofort' },
              { value: 'dringend', label: 'Dringend' },
              { value: 'normal', label: 'Normal' },
            ]} />
          </Form.Item>
          <Form.Item label="Frist (Quittung/Vollzug)" style={{ flex: 1 }}>
            <DatePicker showTime value={frist} onChange={setFrist} style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </div>
        <Button type="primary" htmlType="submit" loading={senden} block>Auftrag erteilen</Button>
      </Form>
    </Card>
  );
}
