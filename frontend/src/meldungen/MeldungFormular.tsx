import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Space, Switch } from 'antd';
import { Select } from '../components/Select';
import { ErfassungsFormular } from '../components/Erfassung';
import { ThunderboltOutlined, SendOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import dayjs from 'dayjs';
import type { Meldungsart, MeldungMeldeweg, MeldungPrioritaet, NeueMeldung, Richtung } from '../api/types';

const { TextArea } = Input;

/** Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss'. */
function dayjsZuWire(d: dayjs.Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

interface MeldungFormWerte {
  absender: string;
  empfaenger?: string;
  meldeweg: MeldungMeldeweg;
  meldungsart: Meldungsart;
  prioritaet: MeldungPrioritaet;
  richtung: Richtung;
  ereigniszeit?: dayjs.Dayjs | null;
  inhalt: string;
  bestaetigung_pflicht: boolean;
  frist_min?: number | null;
}

const DEFAULTS: MeldungFormWerte = {
  absender: '', empfaenger: '', meldeweg: 'funk', meldungsart: 'sonstige',
  prioritaet: 'normal', richtung: 'intern', ereigniszeit: null, inhalt: '',
  bestaetigung_pflicht: false, frist_min: null,
};

/**
 * Wiederholfelder einer Meldungs-Serie (LFH-332/B4). Am Funkgerät wechselt der
 * Wortlaut, nicht die Gegenstelle: Absender, Meldeweg und Adressat bleiben über
 * mehrere Meldungen gleich. Alles andere — insbesondere `inhalt` und
 * `ereigniszeit` — wird geleert, weil ein stehengebliebener Wortlaut die
 * nächste Meldung verfälschen würde.
 *
 * `DEFAULTS` ist gleichzeitig `initialValues` UND Reset-Ziel; die Übernahme
 * läuft deshalb nicht über geänderte Defaults, sondern über das Re-Seeding der
 * Hülle (zurücksetzen, dann die gemerkten Felder wieder setzen).
 */
const UEBERNAHME: (keyof MeldungFormWerte & string)[] = ['absender', 'meldeweg', 'empfaenger'];

export default function MeldungFormular({ senden, onAnlegen, card = true }: {
  senden: boolean;
  /**
   * Speichern. **Muss bei Ablehnung ablehnen** (`mutateAsync`, nicht `mutate`) —
   * die Erfassungshülle lässt den Wortlaut nur dann stehen, wenn sie den
   * Fehlschlag sieht (LFH-332/B4).
   */
  onAnlegen: (d: NeueMeldung) => Promise<unknown>;
  /** Umschließende Card mit Titel rendern. `false` für Inline-Einbettung, wo der
   *  Container den Titel schon liefert (vermeidet doppelte Überschrift, LFH-112). */
  card?: boolean;
}) {
  const [form] = Form.useForm<MeldungFormWerte>();
  const meldungsart = Form.useWatch('meldungsart', form);
  const prioritaet = Form.useWatch('prioritaet', form);
  const bestaetigungPflicht = Form.useWatch('bestaetigung_pflicht', form);

  // Sofort (Art oder Priorität) ⇒ Bestätigungspflicht automatisch an (LFH-97). Der
  // Nutzer kann sie danach manuell wieder abwählen.
  const istSofort = meldungsart === 'sofortmeldung' || prioritaet === 'sofort';
  useEffect(() => {
    if (istSofort) form.setFieldValue('bestaetigung_pflicht', true);
  }, [istSofort, form]);

  /** Fast-Path: Sofortmeldung vorbelegen (Art + Priorität sofort), Fokus auf den Wortlaut. */
  const sofortVorbelegen = () => {
    form.setFieldsValue({ meldungsart: 'sofortmeldung', prioritaet: 'sofort', bestaetigung_pflicht: true });
  };

  /** Fast-Path: Lagemeldung an übergeordnete Führung (extern, LFH-87). */
  const lagemeldungVorbelegen = () => {
    form.setFieldsValue({ meldungsart: 'lagemeldung', richtung: 'extern' });
  };

  // Das `return` ist tragend: die Erfassungshülle wartet auf diese Zusage und
  // lässt die Felder stehen, wenn sie abgelehnt wird. Ein blosser Aufruf würde
  // die Ablehnung an ihr vorbeilaufen lassen und den Wortlaut trotz Fehler-Toast
  // leeren — genau der Fehler, den der Bestand (fire-and-forget + resetFields)
  // hatte.
  const absenden = (w: MeldungFormWerte) =>
    onAnlegen({
      absender: w.absender.trim(),
      empfaenger: w.empfaenger?.trim() || undefined,
      meldeweg: w.meldeweg,
      inhalt: w.inhalt.trim(),
      meldungsart: w.meldungsart,
      prioritaet: w.prioritaet,
      richtung: w.richtung,
      // Ereigniszeit Pflicht: leer ⇒ jetzt (Funk-Realität: meist „eben empfangen").
      ereigniszeit: dayjsZuWire(w.ereigniszeit ?? dayjs()),
      bestaetigung_pflicht: w.bestaetigung_pflicht,
      bestaetigung_frist_min:
        w.bestaetigung_pflicht && w.frist_min != null ? w.frist_min : undefined,
    });

  const formular = (
    <ErfassungsFormular<MeldungFormWerte>
      form={form}
      initialValues={DEFAULTS}
      onErfassen={absenden}
      // Das Inline-Formular schliesst sich nach dem Senden NICHT: Zuklappen ist
      // ausdrückliche Nutzeraktion über den Kopf-Umschalter oder das Kreuz an
      // der Card (LFH-332/B4). Deshalb ist „fertig" hier ein Nichts.
      //
      // Die beiden Speicher-Knöpfe unterscheiden sich damit NUR in der Übernahme:
      // „Meldung erfassen" (auch der Enter-Weg) leert alles wie bisher,
      // „Speichern und nächste" hält Absender/Meldeweg/Adressat fest. Das ist die
      // Aufteilung der Hülle und keine Verschlechterung — der Bestand hat auf dem
      // Enter-Weg ebenfalls vollständig zurückgesetzt.
      onFertig={() => {}}
      laeuft={senden}
      erfassenText="Meldung erfassen"
      serie
      uebernahme={UEBERNAHME}
    >
      {/* Fast-Path (LFH-112): im Formularkörper statt Card-extra, damit sie auch in der
          Inline-Einbettung (card={false}) erhalten bleiben. */}
      <Space style={{ marginBottom: 16 }} wrap>
        <Button danger size="small" icon={<ThunderboltOutlined />} onClick={sofortVorbelegen}>
          Sofortmeldung
        </Button>
        <Button size="small" icon={<SendOutlined />} onClick={lagemeldungVorbelegen}>
          Lagemeldung (extern)
        </Button>
      </Space>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="absender"
            label="Absender (Funkrufname/Stelle)"
            rules={[{ required: true, whitespace: true, message: 'Absender ist erforderlich' }]}
          >
            <Input aria-label="Absender" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="empfaenger" label="Empfänger / Adressat">
            <Input placeholder="z. B. ELW 1, S3" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="meldeweg" label="Meldeweg">
            <Select<MeldungMeldeweg> options={[
              { value: 'funk', label: 'Funk' },
              { value: 'telefon', label: 'Telefon' },
              { value: 'persoenlich', label: 'Persönlich' },
              { value: 'sonstige', label: 'Sonstige' },
            ]} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="meldungsart" label="Meldungsart">
            <Select<Meldungsart> options={[
              { value: 'lagemeldung', label: 'Lagemeldung' },
              { value: 'sofortmeldung', label: 'Sofortmeldung' },
              { value: 'rueckmeldung', label: 'Rückmeldung' },
              { value: 'vollzugsmeldung', label: 'Vollzugsmeldung' },
              { value: 'anfrage', label: 'Anfrage' },
              { value: 'sonstige', label: 'Sonstige' },
            ]} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} sm={8}>
          <Form.Item name="prioritaet" label="Priorität">
            <Select<MeldungPrioritaet> options={[
              { value: 'sofort', label: 'Sofort' },
              { value: 'dringend', label: 'Dringend' },
              { value: 'normal', label: 'Normal' },
            ]} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="richtung" label="Richtung">
            <Select<Richtung> aria-label="Richtung" options={[
              { value: 'intern', label: 'Intern' },
              { value: 'extern', label: 'Extern' },
            ]} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="ereigniszeit" label="Ereigniszeit (≠ Erfassung)">
            <DatePicker showTime style={{ width: '100%' }}
              format="YYYY-MM-DD HH:mm" placeholder="leer = jetzt" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item label="Bestätigung erforderlich (Sofortmeldung)">
        <Space>
          <Form.Item name="bestaetigung_pflicht" valuePropName="checked" noStyle>
            <Switch aria-label="Bestätigung erforderlich" />
          </Form.Item>
          {bestaetigungPflicht && (
            <Form.Item name="frist_min" noStyle>
              <InputNumber
                min={1}
                suffix="Min"
                placeholder="Frist (Default 5)"
                aria-label="Bestätigungsfrist in Minuten"
              />
            </Form.Item>
          )}
        </Space>
      </Form.Item>
      <Form.Item
        name="inhalt"
        label="Inhalt / Wortlaut"
        rules={[{ required: true, whitespace: true, message: 'Inhalt ist erforderlich' }]}
      >
        <TextArea aria-label="Inhalt / Wortlaut" rows={3} />
      </Form.Item>
    </ErfassungsFormular>
  );

  if (!card) return formular;
  return <Card size="small" title="Neue Meldung erfassen">{formular}</Card>;
}
