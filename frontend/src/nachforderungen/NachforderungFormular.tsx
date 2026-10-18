import { AutoComplete, Col, Form, Input, InputNumber, Row } from 'antd';
import {
  ETB_PARTEI_MAX,
  NACHFORDERUNG_ART_MAX,
  NACHFORDERUNG_BEZEICHNUNG_MAX,
} from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { useEffect } from 'react';
import { Paneel } from '../components/instrument';
import { Select } from '../components/Select';
import { ErfassungsFormular, type Speicherung } from '../components/Erfassung';
import type { AdressatKategorie, NachforderungPrioritaet, NeueNachforderung } from '../api/types';
import type { NachforderungVorbelegung } from '../routing/deeplinks';
import {
  externeStellenOptions,
  useExterneStellen,
  zustaendigeLeitstelle,
} from '../stammdaten/externeStellenVorschlaege';
import { teilwortSuche } from '../components/teilwortSuche';

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
  speicherung,
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
  /**
   * Die Anlege-Mutation: ihr Fehler steht im Formular bis zum nächsten Absetzen; Einhängen und
   * Abbrechen räumen ihn (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“).
   */
  speicherung?: Speicherung;
}) {
  const [form] = Form.useForm<FormWerte>();
  // Katalog „Externe Stellen“ (LFH-1194, design.md D8): Vorschläge für die Adressat-Bezeichnung,
  // die zuständige Leitstelle als Vorgabe bei der Kategorie „Leitstelle“.
  const stellen = useExterneStellen().data;
  const stellenOptionen = externeStellenOptions(stellen ?? []);
  const vorgabeLeitstelle = zustaendigeLeitstelle(stellen ?? []) ?? '';
  const kategorie = Form.useWatch('adressatKategorie', form);

  // Vorbelegen, nie überschreiben: nur bei Kategorie „Leitstelle“, leerem und unberührtem Feld.
  // Läuft, sobald die Liste da ist (sie kommt nach dem Einhängen) und bei jedem Wechsel auf
  // „Leitstelle“. Den Reset nach dem Absetzen deckt `initialValues` ab.
  useEffect(() => {
    if (!vorgabeLeitstelle || kategorie !== 'leitstelle') return;
    if (form.getFieldValue('adressatBezeichnung') || form.isFieldTouched('adressatBezeichnung')) {
      return;
    }
    form.setFieldValue('adressatBezeichnung', vorgabeLeitstelle);
  }, [form, kategorie, vorgabeLeitstelle]);

  // Läuft nach dem Einhängen des `<Form>` und nur bei einer NEUEN Vorbelegung (die Seite hält
  // sie identitätsstabil).
  useEffect(() => {
    if (!vorbelegung) return;
    form.setFieldsValue({
      art: vorbelegung.art,
      // Eine Teil-Vorbelegung (LLH-1133) lässt beide leer: die Person trägt sie ein.
      bezeichnung: vorbelegung.bezeichnung ?? '',
      anzahl: vorbelegung.anzahl ?? null,
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
        adressatBezeichnung: vorgabeLeitstelle,
        prioritaet: 'normal',
        begruendung: '',
      }}
      onErfassen={absenden}
      // Das Inline-Formular schließt nach dem Absetzen NICHT — Zuklappen ist ausdrückliche Nutzeraktion.
      onFertig={() => {}}
      laeuft={senden}
      speicherung={speicherung}
      speicherFehlerTitel="Nachforderung nicht abgesetzt"
      speicherFehlerFallback="Absetzen fehlgeschlagen"
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
            <Input
              aria-label="Art"
              placeholder="z. B. RTW, SEG, Sandsäcke"
              maxLength={NACHFORDERUNG_ART_MAX}
            />
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
        <Input aria-label="Bezeichnung" maxLength={NACHFORDERUNG_BEZEICHNUNG_MAX} />
      </Form.Item>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="adressatKategorie" label="Adressat">
            <Select<AdressatKategorie> aria-label="Adressat" options={ADRESSAT_OPTIONEN} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="adressatBezeichnung" label="Adressat-Bezeichnung">
            <AutoComplete
              aria-label="Adressat-Bezeichnung"
              options={stellenOptionen}
              showSearch={teilwortSuche}
              allowClear
              placeholder="z. B. Leitstelle Nord"
              maxLength={ETB_PARTEI_MAX}
            />
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
          <Form.Item
            name="begruendung"
            label="Begründung / Lagebezug"
            // Eine Vorbelegung aus der Verpflegung kann länger sein: sie bleibt stehen und sperrt.
            rules={[zeichenRegel(ETB_PARTEI_MAX, 'Begründung')]}
          >
            {/* Wächst bis vier Zeilen: eine Vorbelegung aus der Verpflegung ist mehrzeilig. */}
            <TextArea autoSize={{ minRows: 1, maxRows: 4 }} count={zeichenGrenze(ETB_PARTEI_MAX)} />
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
