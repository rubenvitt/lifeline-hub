import { Col, Form, Input, InputNumber, Row } from 'antd';
import { useEffect } from 'react';
import { Paneel } from '../components/instrument';
import { Select } from '../components/Select';
import { ErfassungsFormular } from '../components/Erfassung';
import type { AdressatKategorie, NachforderungPrioritaet, NeueNachforderung } from '../api/types';
import type { NachforderungVorbelegung } from '../routing/deeplinks';

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

/**
 * Wiederholfelder einer Serie: meist mehreres bei DERSELBEN Stelle; Art und Bezeichnung
 * wechseln und werden geleert.
 */
const UEBERNAHME: (keyof FormWerte & string)[] = [
  'adressatKategorie',
  'adressatBezeichnung',
  'prioritaet',
];

export default function NachforderungFormular({
  senden,
  onAnlegen,
  card = true,
  vorbelegung,
}: {
  senden: boolean;
  /**
   * Absetzen. **Muss bei Ablehnung ablehnen** (`mutateAsync`) — nur dann lässt die
   * Erfassungshülle die Eingabe stehen.
   */
  onAnlegen: (d: NeueNachforderung) => Promise<unknown>;
  /** Umschließendes Paneel mit Titel rendern. `false`, wo der Container den Titel schon liefert. */
  card?: boolean;
  /**
   * Vorbelegung aus einem Deeplink („Nachfordern" aus der Verpflegung).
   * Bewusst NICHT über `initialValues`: die Hülle setzt nach jedem Absetzen darauf zurück und
   * das Formular bleibt offen — dieselbe Nachforderung stünde sofort wieder vorbelegt da, einen
   * Druck vor der Dublette. `setFieldsValue` beim Öffnen ist Vorbelegen, kein Reset.
   */
  vorbelegung?: NachforderungVorbelegung | null;
}) {
  const [form] = Form.useForm<FormWerte>();

  // Läuft nach dem Einhängen des `<Form>` und nur bei einer NEUEN Vorbelegung (die Seite hält
  // sie identitätsstabil).
  useEffect(() => {
    if (!vorbelegung) return;
    form.setFieldsValue({
      art: vorbelegung.art,
      bezeichnung: vorbelegung.bezeichnung,
      anzahl: vorbelegung.anzahl,
      begruendung: vorbelegung.begruendung ?? '',
    });
  }, [form, vorbelegung]);

  // Das `return` ist tragend: die Hülle wartet auf diese Zusage.
  const absenden = (w: FormWerte) => {
    return onAnlegen({
      art: w.art.trim(),
      bezeichnung: w.bezeichnung.trim(),
      anzahl: w.anzahl ?? undefined,
      adressat_kategorie: w.adressatKategorie,
      adressat_bezeichnung: w.adressatBezeichnung?.trim() || undefined,
      begruendung: w.begruendung?.trim() || undefined,
      prioritaet: w.prioritaet,
    });
  };

  const formular = (
    <ErfassungsFormular<FormWerte>
      form={form}
      initialValues={{
        art: '',
        anzahl: null,
        bezeichnung: '',
        adressatKategorie: 'leitstelle',
        adressatBezeichnung: '',
        prioritaet: 'normal',
        begruendung: '',
      }}
      onErfassen={absenden}
      // Das Inline-Formular schließt nach dem Absetzen NICHT — Zuklappen ist ausdrückliche Nutzeraktion.
      onFertig={() => {}}
      laeuft={senden}
      erfassenText="Nachforderung absetzen"
      serie
      uebernahme={UEBERNAHME}
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
            <Select<NachforderungPrioritaet>
              options={[
                { value: 'sofort', label: 'Sofort' },
                { value: 'dringend', label: 'Dringend' },
                { value: 'normal', label: 'Normal' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="begruendung" label="Begründung / Lagebezug">
            {/* Wächst bis vier Zeilen: eine Vorbelegung aus der Verpflegung ist mehrzeilig. */}
            <TextArea autoSize={{ minRows: 1, maxRows: 4 }} />
          </Form.Item>
        </Col>
      </Row>
    </ErfassungsFormular>
  );

  if (!card) return formular;
  return (
    <Paneel titel="Nachforderung absetzen" koerperPolster>
      {formular}
    </Paneel>
  );
}
