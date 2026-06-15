import { App, Button, Card, DatePicker, Form, Input, Select } from 'antd';
import { useEffect } from 'react';
import dayjs from 'dayjs';
import type { AdressatKategorie, AuftragPrioritaet, NeuerAuftrag, NeuerEmpfaenger, Richtung } from '../api/types';

const EXTERN_OPTIONEN: { value: AdressatKategorie; label: string }[] = [
  { value: 'leitstelle', label: 'Leitstelle' },
  { value: 'nachbar_ea', label: 'Nachbar-Einsatzabschnitt' },
  { value: 'uebergeordnet', label: 'Übergeordnete Führung' },
  { value: 'andere_bos', label: 'Andere BOS' },
];

const { TextArea } = Input;

export interface ZielOption {
  id: number;
  name: string;
}

/** Werte des Formulars (lokale Picker-Zeiten, vor der UTC-Wandlung). */
interface FormWerte {
  ziele: string[];
  funktionText: string;
  externKategorie: AdressatKategorie;
  externBezeichnung: string;
  text: string;
  absicht: string;
  lage: string;
  ort: string;
  zeit: string;
  mittel: string;
  verbindung: string;
  sicherheit: string;
  prioritaet: AuftragPrioritaet;
  richtung: Richtung;
  frist: dayjs.Dayjs | null;
  erteiltAm: dayjs.Dayjs | null;
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

export default function AuftragFormular({ senden, abschnitte, einheiten, onAnlegen, initialText }: {
  senden: boolean;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  onAnlegen: (d: NeuerAuftrag) => void;
  /** Vorbelegung des Auftragstexts (z. B. Chat-Heraufstufung, LFH-101). */
  initialText?: string;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  // Richtung steuert die Sichtbarkeit der externen Adressat-Felder.
  const richtung = Form.useWatch('richtung', form);

  // initialText kann verzögert eintreffen (z. B. Heraufstufung) → ins Feld spiegeln.
  useEffect(() => {
    if (initialText) form.setFieldValue('text', initialText);
  }, [initialText, form]);

  const onFinish = (w: FormWerte) => {
    const empfaenger = baueEmpfaenger(w.ziele ?? [], w.funktionText ?? '');
    // Externer Adressat (LFH-87): bei Richtung extern als Empfänger-Zeile ergänzen.
    if (w.richtung === 'extern' && (w.externBezeichnung ?? '').trim()) {
      empfaenger.push({
        empfaenger_typ: 'extern',
        extern_kategorie: w.externKategorie,
        extern_bezeichnung: w.externBezeichnung.trim(),
      });
    }
    if (empfaenger.length === 0) { message.error('Mindestens ein Empfänger ist erforderlich'); return; }
    onAnlegen({
      auftrag_text: w.text.trim(),
      absicht: w.absicht?.trim() || undefined,
      lage: w.lage?.trim() || undefined,
      ort: w.ort?.trim() || undefined,
      zeit: w.zeit?.trim() || undefined,
      mittel: w.mittel?.trim() || undefined,
      verbindung: w.verbindung?.trim() || undefined,
      sicherheit: w.sicherheit?.trim() || undefined,
      prioritaet: w.prioritaet,
      richtung: w.richtung,
      frist_at: dayjsZuWire(w.frist ?? null),
      erteilt_at: dayjsZuWire(w.erteiltAm ?? null),
      empfaenger,
    });
    form.resetFields();
  };

  const zielOptionen = [
    { label: 'Einsatzabschnitte', options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })) },
    { label: 'Einheiten', options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })) },
  ];

  return (
    <Card size="small" title="Neuer Auftrag/Befehl">
      <Form<FormWerte>
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          ziele: [], funktionText: '', externKategorie: 'leitstelle', externBezeichnung: '',
          text: initialText ?? '', absicht: '', lage: '', ort: '', zeit: '', mittel: '',
          verbindung: '', sicherheit: '', prioritaet: 'normal', richtung: 'intern',
          frist: null, erteiltAm: dayjs(),
        }}
      >
        <Form.Item name="ziele" label="Empfänger – Abschnitte / Einheiten">
          <Select
            mode="multiple"
            options={zielOptionen}
            placeholder="Abschnitte / Einheiten wählen"
            optionFilterProp="label"
            allowClear
          />
        </Form.Item>
        <Form.Item name="funktionText" label="Weitere Empfänger (Funktion, kommagetrennt)">
          <Input placeholder="z. B. S3, Fachberater" />
        </Form.Item>
        {richtung === 'extern' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Form.Item name="externKategorie" label="Externe Stelle" style={{ flex: 1 }}>
              <Select<AdressatKategorie> aria-label="Externe Stelle" options={EXTERN_OPTIONEN} />
            </Form.Item>
            <Form.Item name="externBezeichnung" label="Bezeichnung der Stelle" style={{ flex: 1 }}>
              <Input aria-label="Externe Bezeichnung" placeholder="z. B. Leitstelle Nord" />
            </Form.Item>
          </div>
        )}
        <Form.Item
          name="text"
          label="Auftrag / Was"
          rules={[{ required: true, message: 'Auftragstext ist erforderlich' }]}
        >
          <TextArea aria-label="Auftrag / Was" rows={2} />
        </Form.Item>
        <Form.Item name="absicht" label="Absicht / Ziel">
          <TextArea rows={1} />
        </Form.Item>
        <Form.Item name="lage" label="Lage">
          <TextArea rows={1} />
        </Form.Item>
        <Form.Item name="ort" label="Ort / Wo">
          <Input />
        </Form.Item>
        <Form.Item name="zeit" label="Zeit / Wann">
          <Input placeholder="z. B. sofort, bis 14:00, nach Eintreffen" />
        </Form.Item>
        <Form.Item name="mittel" label="Mittel / Womit">
          <Input />
        </Form.Item>
        <Form.Item name="verbindung" label="Verbindung / Meldewege">
          <Input />
        </Form.Item>
        <Form.Item name="sicherheit" label="Sicherheit / Besonderes">
          <Input />
        </Form.Item>
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item name="prioritaet" label="Priorität" style={{ flex: 1 }}>
            <Select<AuftragPrioritaet> options={[
              { value: 'sofort', label: 'Sofort' },
              { value: 'dringend', label: 'Dringend' },
              { value: 'normal', label: 'Normal' },
            ]} />
          </Form.Item>
          <Form.Item name="richtung" label="Richtung" style={{ flex: 1 }}>
            <Select<Richtung> aria-label="Richtung" options={[
              { value: 'intern', label: 'Intern' },
              { value: 'extern', label: 'Extern' },
            ]} />
          </Form.Item>
          <Form.Item name="frist" label="Frist (Quittung/Vollzug)" style={{ flex: 1 }}>
            <DatePicker showTime style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </div>
        <Form.Item name="erteiltAm" label="Erteilt am (mündlich/per Funk – optional)">
          <DatePicker showTime style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={senden} block>Auftrag erteilen</Button>
      </Form>
    </Card>
  );
}
