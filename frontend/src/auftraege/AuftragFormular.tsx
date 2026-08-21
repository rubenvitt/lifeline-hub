import { App, Card, Col, Collapse, DatePicker, Form, Input, Row } from 'antd';
import { Select } from '../components/Select';
import { ErfassungsFormular } from '../components/Erfassung';
import { useEffect, type ReactNode } from 'react';
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
  /**
   * EIN Empfängerfeld für beide Sorten (LFH-343 · C8, Befund H49). Strukturierte
   * Ziele tragen den Präfix `abschnitt:`/`einheit:` und kommen aus den Optionen;
   * alles andere ist ein freier Funktionstext (`mode="tags"`).
   *
   * Vorher standen dafür zwei Felder nebeneinander. Das Feldbudget von vier
   * sichtbaren Feldern gibt sie nicht her — und den Freitext hinter den Collapse
   * zu schieben ging nicht: ohne gepflegte Abschnitte/Einheiten ist er der
   * EINZIGE Weg, den Pflicht-Empfänger zu setzen.
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
 * Wandelt die Werte des EINEN Empfängerfeldes in Empfänger-DTOs (LFH-343 · C8).
 *
 * Die beiden Sorten unterscheidet der Präfix: `abschnitt:<id>` und `einheit:<id>`
 * stammen aus den Optionen, alles andere hat jemand frei eingetippt und wird zum
 * Funktionstext. Ein Funktionstext, der zufällig wie ein Präfixwert aussähe
 * („einheit:7"), ist praktisch ausgeschlossen und wäre auch in der früheren
 * Zwei-Felder-Fassung mehrdeutig gewesen.
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
 * Wiederholfelder einer Auftrags-Serie (LFH-343 · C8, Befund H52). An derselben
 * Lage geht der nächste Auftrag meist an dieselbe Stelle, mit derselben
 * Dringlichkeit und in dieselbe Richtung; der WORTLAUT wechselt — er wird
 * geleert, ein stehengebliebener verfälschte den nächsten Auftrag.
 */
const UEBERNAHME: (keyof FormWerte & string)[] = ['empfaenger', 'prioritaet', 'richtung'];

export default function AuftragFormular({
  senden, abschnitte, einheiten, onAnlegen, initialText, zitat, serie = false, onFertig,
  card = true,
}: {
  senden: boolean;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  /**
   * Speichern. **Muss bei Ablehnung ablehnen** (`mutateAsync`, nicht `mutate`) —
   * die Erfassungshülle lässt den Wortlaut nur dann stehen, wenn sie den
   * Fehlschlag sieht (LFH-332/B4).
   */
  onAnlegen: (d: NeuerAuftrag) => Promise<unknown>;
  /** Vorbelegung des Auftragstexts (z. B. Chat-Heraufstufung, LFH-101). */
  initialText?: string;
  /**
   * Read-only Wortlaut der Quelle über den Feldern (LFH-343 · C8). Wer aus einer
   * Meldung oder Nachricht einen Auftrag formuliert, braucht den Urtext im Blick —
   * ändern darf er ihn nicht, die Quelle ist beweissichernd.
   */
  zitat?: ReactNode;
  /**
   * Serienmodus (LFH-343 · C8, Befund H52): „Speichern und nächste" plus Zähler.
   *
   * In den beiden Modal-Einbettungen bewusst AUS: dort entsteht genau EIN Auftrag
   * zu genau EINER Meldung bzw. Nachricht — ein „Nächstes" gibt es nicht, und der
   * Aufrufer schliesst den Dialog nach dem Speichern ohnehin.
   */
  serie?: boolean;
  /** Nach erfolgreichem Einzel-Erfassen. Ohne Angabe passiert nichts — das
   *  Inline-Formular bleibt offen (LFH-332/B4). */
  onFertig?: () => void;
  /** Umschließende Card mit Titel rendern. `false` für Inline-/Modal-Einbettung,
   *  wo der Container den Titel schon liefert (vermeidet doppelte Überschrift, LFH-112). */
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
   * Das `return` ist tragend (LFH-332/B4): die Erfassungshülle wartet auf diese
   * Zusage und lässt die Felder stehen, wenn sie bricht. Ein blosser Aufruf liesse
   * die Ablehnung an ihr vorbeilaufen und leerte den Wortlaut trotz Fehler-Toast.
   *
   * Auch der fehlende Empfänger LEHNT AB statt still zurückzukehren — sonst
   * räumte die Hülle das Formular, obwohl nichts gespeichert wurde.
   */
  const absenden = (w: FormWerte) => {
    const empfaenger = baueEmpfaenger(w.empfaenger ?? []);
    // Externer Adressat (LFH-87): bei Richtung extern als Empfänger-Zeile ergänzen.
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
    { label: 'Einsatzabschnitte', options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })) },
    { label: 'Einheiten', options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })) },
  ];

  /**
   * Befehlsschema und Richtungs-Angaben (LFH-343 · C8, Befund H49): die sieben
   * SKK-Felder plus die drei, die das Ticket nicht nennt, aber mitzählt.
   *
   * `richtung` ist der Grenzfall — sie steuert die Sichtbarkeit der Extern-Felder
   * und ist damit kein reines Detail. Sie geht trotzdem hinein, weil `intern` der
   * Normalfall ist und der externe Auftrag der begründete Sonderfall; ein fünftes
   * sichtbares Feld sprengte das Budget. Die Extern-Felder gehen MIT, sonst
   * stünden sie sichtbar unter einem eingeklappten Auslöser.
   *
   * Bewusst OHNE `forceRender`: die Felder sollen erst beim Aufklappen im DOM
   * stehen. Nur so ist „im Ausgangszustand höchstens vier Felder" überhaupt
   * prüfbar — und nur zusammen mit der zweiten Hälfte („Aufklappen bringt die
   * sieben") ist die Zusicherung widerlegbar.
   */
  const schemaFelder = (
    <>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="richtung" label="Richtung">
            <Select<Richtung> aria-label="Richtung" options={[
              { value: 'intern', label: 'Intern' },
              { value: 'extern', label: 'Extern' },
            ]} />
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
            <Input aria-label="Zeit / Wann" placeholder="z. B. sofort, bis 14:00, nach Eintreffen" />
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
        empfaenger: [], externKategorie: 'leitstelle', externBezeichnung: '',
        text: initialText ?? '', absicht: '', lage: '', ort: '', zeit: '', mittel: '',
        verbindung: '', sicherheit: '', prioritaet: 'normal', richtung: 'intern',
        frist: null, erteiltAm: dayjs(),
      }}
      onErfassen={absenden}
      // Wie beim Meldungs-Zwilling: das Inline-Formular schliesst sich nach dem
      // Senden NICHT — Zuklappen ist ausdrückliche Nutzeraktion über den
      // Kopf-Umschalter oder das Kreuz an der Card (LFH-332/B4). In den beiden
      // Modal-Einbettungen schliesst der Aufrufer selbst.
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
          {/* EIN Feld für beide Empfängersorten — Begründung an `FormWerte.empfaenger`.
              `mode="tags"` nimmt die Optionen UND freien Text; getrennt wird am
              Präfix in `baueEmpfaenger`. Das Komma bleibt Trennzeichen wie im
              früheren Funktions-Freitext, damit „S3, Fachberater" weiterhin zwei
              Empfänger ergibt. */}
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
            <Select<AuftragPrioritaet> aria-label="Priorität" options={[
              { value: 'sofort', label: 'Sofort' },
              { value: 'dringend', label: 'Dringend' },
              { value: 'normal', label: 'Normal' },
            ]} />
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
        items={[{
          key: 'schema',
          label: 'Befehlsschema und Richtung (optional)',
          children: schemaFelder,
        }]}
      />
    </ErfassungsFormular>
  );

  if (!card) return formular;
  return <Card size="small" title="Neuer Auftrag/Befehl">{formular}</Card>;
}
