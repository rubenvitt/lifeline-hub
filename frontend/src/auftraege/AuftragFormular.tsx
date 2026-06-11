import { App, Button, Card, DatePicker, Form, Input, Select } from 'antd';
import { useState } from 'react';
import dayjs from 'dayjs';
import type { AuftragPrioritaet, NeuerAuftrag, NeuerEmpfaenger } from '../api/types';

const { TextArea } = Input;

export interface ZielOption {
  id: number;
  name: string;
}

/** Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss'. */
function dayjsZuWire(d: dayjs.Dayjs | null): string | undefined {
  return d ? d.utc().format('YYYY-MM-DD HH:mm:ss') : undefined;
}

/** Wandelt ausgewählte "typ:id"-Werte + Funktions-Freitext in Empfänger-DTOs. */
function baueEmpfaenger(ziele: string[], funktionText: string): NeuerEmpfaenger[] {
  const strukturiert: NeuerEmpfaenger[] = ziele.map((wert) => {
    const [typ, idRoh] = wert.split(':');
    const id = Number(idRoh);
    return typ === 'abschnitt'
      ? { empfaenger_typ: 'abschnitt', abschnitt_id: id }
      : { empfaenger_typ: 'einheit', einheit_id: id };
  });
  const funktionen: NeuerEmpfaenger[] = funktionText
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((funktion_text) => ({ empfaenger_typ: 'funktion', funktion_text }));
  return [...strukturiert, ...funktionen];
}

export default function AuftragFormular({ senden, abschnitte, einheiten, onAnlegen }: {
  senden: boolean;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
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
  const [ziele, setZiele] = useState<string[]>([]);
  const [funktionText, setFunktionText] = useState('');

  const zielOptionen = [
    { label: 'Einsatzabschnitte', options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })) },
    { label: 'Einheiten', options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })) },
  ];

  const absenden = () => {
    if (!text.trim()) { message.error('Auftragstext ist erforderlich'); return; }
    const empfaenger = baueEmpfaenger(ziele, funktionText);
    if (empfaenger.length === 0) { message.error('Mindestens ein Empfänger ist erforderlich'); return; }
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
    setVerbindung(''); setSicherheit(''); setFrist(null); setZiele([]); setFunktionText('');
  };

  return (
    <Card size="small" title="Neuer Auftrag/Befehl">
      <Form layout="vertical" onFinish={absenden}>
        <Form.Item label="Empfänger – Abschnitte / Einheiten">
          <Select
            mode="multiple"
            value={ziele}
            onChange={setZiele}
            options={zielOptionen}
            placeholder="Abschnitte / Einheiten wählen"
            optionFilterProp="label"
            allowClear
          />
        </Form.Item>
        <Form.Item label="Weitere Empfänger (Funktion, kommagetrennt)">
          <Input value={funktionText} onChange={(e) => setFunktionText(e.target.value)} placeholder="z. B. S3, Fachberater" />
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
