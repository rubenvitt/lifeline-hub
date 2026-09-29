import { App, Col, Collapse, DatePicker, Form, Input, Row } from 'antd';
import { Paneel } from '../components/instrument';
import { Select } from '../components/Select';
import { ErfassungsFormular } from '../components/Erfassung';
import { useEffect, type ReactNode } from 'react';
import dayjs from 'dayjs';
import type {
  AdressatKategorie,
  AuftragPrioritaet,
  NeuerAuftrag,
  NeuerEmpfaenger,
  Richtung,
} from '../api/types';

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
  /**
   * EIN Empfängerfeld für beide Sorten: strukturierte Ziele tragen den Präfix
   * `abschnitt:`/`einheit:`, alles andere ist freier Funktionstext (`mode="tags"`). Zwei Felder
   * sprengten das Budget, und der Freitext darf nicht hinter den Collapse: ohne gepflegte
   * Abschnitte/Einheiten ist er der EINZIGE Weg zum Pflicht-Empfänger.
   */
  empfaenger: string[];
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

/**
 * Wandelt die Werte des Empfängerfeldes in Empfänger-DTOs: `abschnitt:<id>`/`einheit:<id>`
 * stammen aus den Optionen, alles andere wird Funktionstext.
 */
function baueEmpfaenger(werte: string[]): NeuerEmpfaenger[] {
  return werte.flatMap((wert): NeuerEmpfaenger[] => {
    const trenner = wert.indexOf(':');
    const typ = trenner === -1 ? '' : wert.slice(0, trenner);
    const id = Number(wert.slice(trenner + 1));
    if (typ === 'abschnitt' && Number.isFinite(id)) {
      return [{ empfaenger_typ: 'abschnitt', abschnitt_id: id }];
    }
    if (typ === 'einheit' && Number.isFinite(id)) {
      return [{ empfaenger_typ: 'einheit', einheit_id: id }];
    }
    const funktion_text = wert.trim();
    return funktion_text ? [{ empfaenger_typ: 'funktion', funktion_text }] : [];
  });
}

/**
 * Wiederholfelder einer Auftrags-Serie: gleiche Stelle, Dringlichkeit und Richtung; der
 * WORTLAUT wird geleert, ein stehengebliebener verfälschte den nächsten Auftrag.
 */
const UEBERNAHME: (keyof FormWerte & string)[] = ['empfaenger', 'prioritaet', 'richtung'];

export default function AuftragFormular({
  senden,
  abschnitte,
  einheiten,
  onAnlegen,
  initialText,
  zitat,
  serie = false,
  onFertig,
  card = true,
}: {
  senden: boolean;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  /**
   * Speichern. **Muss bei Ablehnung ablehnen** (`mutateAsync`) — nur dann lässt die
   * Erfassungshülle den Wortlaut stehen.
   */
  onAnlegen: (d: NeuerAuftrag) => Promise<unknown>;
  /** Vorbelegung des Auftragstexts (z. B. Chat-Heraufstufung). */
  initialText?: string;
  /**
   * Read-only Wortlaut der Quelle über den Feldern: wer aus einer Meldung einen Auftrag
   * formuliert, braucht den Urtext, ändern darf er ihn nicht.
   */
  zitat?: ReactNode;
  /**
   * Serienmodus: „Speichern und nächste" plus Zähler. In den Modal-Einbettungen AUS — dort
   * entsteht genau ein Auftrag zu einer Meldung bzw. Nachricht.
   */
  serie?: boolean;
  /** Nach erfolgreichem Einzel-Erfassen. Ohne Angabe bleibt das Inline-Formular offen. */
  onFertig?: () => void;
  /** Umschließendes Paneel mit Titel rendern. `false`, wo der Container den Titel schon liefert. */
  card?: boolean;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  // Richtung steuert die Sichtbarkeit der externen Adressat-Felder.
  const richtung = Form.useWatch('richtung', form);

  // initialText kann verzögert eintreffen (z. B. Heraufstufung) → ins Feld spiegeln.
  useEffect(() => {
    if (initialText) form.setFieldValue('text', initialText);
  }, [initialText, form]);

  /**
   * Das `return` ist tragend: die Hülle lässt die Felder stehen, wenn die Zusage bricht. Auch der
   * fehlende Empfänger LEHNT AB, sonst räumte die Hülle ein Formular, das nichts gespeichert hat.
   */
  const absenden = (w: FormWerte) => {
    const empfaenger = baueEmpfaenger(w.empfaenger ?? []);
    // Externer Adressat: bei Richtung extern als Empfänger-Zeile ergänzen.
    if (w.richtung === 'extern' && (w.externBezeichnung ?? '').trim()) {
      empfaenger.push({
        empfaenger_typ: 'extern',
        extern_kategorie: w.externKategorie,
        extern_bezeichnung: w.externBezeichnung.trim(),
      });
    }
    if (empfaenger.length === 0) {
      message.error('Mindestens ein Empfänger ist erforderlich');
      return Promise.reject(new Error('Kein Empfänger'));
    }
    return onAnlegen({
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
  };

  const zielOptionen = [
    {
      label: 'Einsatzabschnitte',
      options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })),
    },
    {
      label: 'Einheiten',
      options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })),
    },
  ];

  /**
   * Befehlsschema und Richtungs-Angaben hinter dem Collapse. `richtung` steuert zwar die
   * Extern-Felder, geht aber mit, weil `intern` der Normalfall ist; die Extern-Felder gehen MIT,
   * sonst stünden sie sichtbar unter einem eingeklappten Auslöser.
   * Bewusst OHNE `forceRender`: nur so ist „im Ausgangszustand höchstens vier Felder" samt
   * Gegenprobe („Aufklappen bringt die sieben") prüfbar.
   */
  const schemaFelder = (
    <>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="richtung" label="Richtung">
            <Select<Richtung>
              aria-label="Richtung"
              options={[
                { value: 'intern', label: 'Intern' },
                { value: 'extern', label: 'Extern' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="erteiltAm" label="Erteilt am (mündlich/per Funk – optional)">
            <DatePicker showTime style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </Col>
      </Row>
      {richtung === 'extern' && (
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="externKategorie" label="Externe Stelle">
              <Select<AdressatKategorie> aria-label="Externe Stelle" options={EXTERN_OPTIONEN} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="externBezeichnung" label="Bezeichnung der Stelle">
              <Input aria-label="Externe Bezeichnung" placeholder="z. B. Leitstelle Nord" />
            </Form.Item>
          </Col>
        </Row>
      )}
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="absicht" label="Absicht / Ziel">
            <TextArea aria-label="Absicht / Ziel" rows={1} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="lage" label="Lage">
            <TextArea aria-label="Lage" rows={1} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} sm={8}>
          <Form.Item name="ort" label="Ort / Wo">
            <Input aria-label="Ort / Wo" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="zeit" label="Zeit / Wann">
            <Input
              aria-label="Zeit / Wann"
              placeholder="z. B. sofort, bis 14:00, nach Eintreffen"
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="mittel" label="Mittel / Womit">
            <Input aria-label="Mittel / Womit" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="verbindung" label="Verbindung / Meldewege">
            <Input aria-label="Verbindung / Meldewege" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="sicherheit" label="Sicherheit / Besonderes">
            <Input aria-label="Sicherheit / Besonderes" />
          </Form.Item>
        </Col>
      </Row>
    </>
  );

  const formular = (
    <ErfassungsFormular<FormWerte>
      form={form}
      initialValues={{
        empfaenger: [],
        externKategorie: 'leitstelle',
        externBezeichnung: '',
        text: initialText ?? '',
        absicht: '',
        lage: '',
        ort: '',
        zeit: '',
        mittel: '',
        verbindung: '',
        sicherheit: '',
        prioritaet: 'normal',
        richtung: 'intern',
        frist: null,
        erteiltAm: dayjs(),
      }}
      onErfassen={absenden}
      // Das Inline-Formular schließt nach dem Senden NICHT; in den Modal-Einbettungen schließt der
      // Aufrufer selbst.
      onFertig={onFertig ?? (() => {})}
      laeuft={senden}
      erfassenText="Auftrag erteilen"
      serie={serie}
      uebernahme={UEBERNAHME}
    >
      {zitat}
      {/* „Auftrag / Was" bleibt oben in voller Breite. */}
      <Form.Item
        name="text"
        label="Auftrag / Was"
        rules={[{ required: true, message: 'Auftragstext ist erforderlich' }]}
      >
        <TextArea aria-label="Auftrag / Was" rows={2} />
      </Form.Item>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          {/* EIN Feld für beide Empfängersorten (Begründung an `FormWerte.empfaenger`). Das Komma bleibt
             Trennzeichen, damit „S3, Fachberater" zwei Empfänger ergibt. */}
          <Form.Item name="empfaenger" label="Empfänger">
            <Select
              mode="tags"
              aria-label="Empfänger"
              options={zielOptionen}
              placeholder="Abschnitt, Einheit oder Funktion (z. B. S3)"
              allowClear
              tokenSeparators={[',']}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={6}>
          <Form.Item name="prioritaet" label="Priorität">
            <Select<AuftragPrioritaet>
              aria-label="Priorität"
              options={[
                { value: 'sofort', label: 'Sofort' },
                { value: 'dringend', label: 'Dringend' },
                { value: 'normal', label: 'Normal' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={6}>
          <Form.Item name="frist" label="Frist (Quittung/Vollzug)">
            <DatePicker showTime style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </Col>
      </Row>
      <Collapse
        ghost
        style={{ marginInline: -8, marginBottom: 8 }}
        items={[
          {
            key: 'schema',
            label: 'Befehlsschema und Richtung (optional)',
            children: schemaFelder,
          },
        ]}
      />
    </ErfassungsFormular>
  );

  if (!card) return formular;
  return (
    <Paneel titel="Neuer Auftrag/Befehl" koerperPolster>
      {formular}
    </Paneel>
  );
}
