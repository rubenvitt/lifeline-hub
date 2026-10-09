import { Col, Collapse, Form, Input, Row, type FormInstance } from 'antd';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { serverJetzt } from '../offline/serveruhr';
import { Paneel } from '../components/instrument';
import { Select } from '../components/Select';
import { ErfassungsFormular, type Speicherung } from '../components/Erfassung';
import { useEffect, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import type {
  AdressatKategorie,
  AuftragPrioritaet,
  NeuerAuftrag,
  NeuerEmpfaenger,
  Richtung,
} from '../api/types';
import {
  dekodiere,
  funktionsOptionen,
  type FunktionsVorschlaege,
} from '../fuehrung/funktionsOptionenKern';
import { useFunktionsVorschlaege } from '../fuehrung/useFunktionsVorschlaege';
import {
  AUFTRAG_BEFEHLSFELD_MAX,
  AUFTRAG_EMPFAENGER_MAX,
  AUFTRAG_EXTERN_BEZEICHNUNG_MAX,
  AUFTRAG_TEXT_MAX,
  FUNKTION_TEXT_MAX,
} from '../api/eingabegrenzen';
import { grenzeText, istZuLang, zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';

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

/** Werte des Formulars; Zeiten sind Zeitpunkte, das Feld zeigt die Anzeigezone (LFH-692). */
interface FormWerte {
  /**
   * EIN Empfängerfeld für alle Sorten: strukturierte Ziele tragen den Präfix
   * `abschnitt:`/`einheit:`/`funktion:` (Katalog, LFH-549), alles andere ist freier Funktionstext
   * (`mode="tags"`). Zwei Felder sprengten das Budget, und der Freitext darf nicht hinter den
   * Collapse: ohne gepflegte Abschnitte/Einheiten ist er ein Weg zum Pflicht-Empfänger.
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

/**
 * Wandelt die Werte des Empfängerfeldes in Empfänger-DTOs: `abschnitt:<id>`/`einheit:<id>`
 * stammen aus den Optionen, `funktion:<code>` aus dem Katalog (LFH-549), alles andere wird
 * Funktionstext — ohne Rückschluss von „S3“ auf den Code (`fuehrung/funktionsOptionenKern.ts`).
 */
function baueEmpfaenger(
  werte: string[],
  katalog: FunktionsVorschlaege['katalog'],
): NeuerEmpfaenger[] {
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
    const angabe = dekodiere(wert, katalog);
    if (angabe.funktion) {
      return [
        {
          empfaenger_typ: 'funktion',
          funktion: angabe.funktion,
          ...(angabe.text ? { funktion_text: angabe.text } : {}),
        },
      ];
    }
    return angabe.text ? [{ empfaenger_typ: 'funktion', funktion_text: angabe.text }] : [];
  });
}

/**
 * Freie Empfänger-Texte über der Grenze des Servers (`funktion_text`, LFH-937): der Tag-Modus hat
 * keinen Zähler, deshalb eine Regel statt eines stillen Kürzens.
 */
function empfaengerRegel(katalog: FunktionsVorschlaege['katalog']) {
  return {
    validator: (_: unknown, werte: unknown) =>
      Array.isArray(werte) &&
      baueEmpfaenger(werte as string[], katalog).some((e) =>
        istZuLang(e.funktion_text, FUNKTION_TEXT_MAX),
      )
        ? Promise.reject(
            new Error(
              `Ein Empfänger darf höchstens ${grenzeText(FUNKTION_TEXT_MAX)} Zeichen lang sein`,
            ),
          )
        : Promise.resolve(),
  };
}

/**
 * Alle Empfänger eines Auftrags: die Werte des Empfängerfeldes und bei Richtung „extern“ mit
 * Bezeichnung der externe Adressat. Dieselbe Rechnung für Regel und Absenden, sonst ließe die
 * Regel durch, was beim Absenden leer bliebe.
 */
function alleEmpfaenger(
  w: Pick<FormWerte, 'empfaenger' | 'richtung' | 'externKategorie' | 'externBezeichnung'>,
  katalog: FunktionsVorschlaege['katalog'],
): NeuerEmpfaenger[] {
  const empfaenger = baueEmpfaenger(w.empfaenger ?? [], katalog);
  if (w.richtung === 'extern' && (w.externBezeichnung ?? '').trim()) {
    empfaenger.push({
      empfaenger_typ: 'extern',
      extern_kategorie: w.externKategorie,
      extern_bezeichnung: w.externBezeichnung.trim(),
    });
  }
  return empfaenger;
}

/**
 * Pflicht-Empfänger als Regel am Feld (LFH-1077): eine Prüfung ohne Server ist kein Speicherfehler
 * und kein Toast (`frontend/AGENTS.md`, „Rückwege und Fehler“). Der externe Adressat zählt mit;
 * wie das Feld `richtung` und `externBezeichnung` folgt, steht am Effekt in `AuftragFormular`.
 */
function pflichtEmpfaengerRegel(
  katalog: FunktionsVorschlaege['katalog'],
  { getFieldValue }: Pick<FormInstance<FormWerte>, 'getFieldValue'>,
) {
  return {
    validator: (_: unknown, werte: unknown) =>
      alleEmpfaenger(
        {
          empfaenger: Array.isArray(werte) ? (werte as string[]) : [],
          richtung: getFieldValue('richtung'),
          externKategorie: getFieldValue('externKategorie'),
          externBezeichnung: String(getFieldValue('externBezeichnung') ?? ''),
        },
        katalog,
      ).length === 0
        ? Promise.reject(new Error('Mindestens ein Empfänger ist erforderlich'))
        : Promise.resolve(),
  };
}

/**
 * Gesamtzahl der Empfänger (LFH-937): `maxCount` am Select begrenzt nur die Tags; bei Richtung
 * „extern“ mit Bezeichnung kommt der externe Adressat dazu, 50 Tags ergäben 51 Empfänger und 400.
 */
function empfaengerAnzahlRegel({ getFieldValue }: Pick<FormInstance<FormWerte>, 'getFieldValue'>) {
  return {
    validator: (_: unknown, werte: unknown) => {
      const tags = Array.isArray(werte) ? werte.length : 0;
      const extern =
        getFieldValue('richtung') === 'extern' &&
        String(getFieldValue('externBezeichnung') ?? '').trim() !== '';
      return tags + (extern ? 1 : 0) > AUFTRAG_EMPFAENGER_MAX
        ? Promise.reject(new Error(`Höchstens ${AUFTRAG_EMPFAENGER_MAX} Empfänger je Auftrag`))
        : Promise.resolve();
    },
  };
}

/**
 * Befehlsschema: Zähler ab 80 % und Sperre über der Grenze statt nativem `maxLength` (D8: natives
 * `maxLength` nur, wo antd nicht zählt); ein vorbelegter längerer Wert bleibt stehen (LFH-937).
 */
const BEFEHLSFELD_ZAEHLER = zeichenGrenze(AUFTRAG_BEFEHLSFELD_MAX);
const befehlsfeldRegel = (feld: string) => zeichenRegel(AUFTRAG_BEFEHLSFELD_MAX, feld);

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
  speicherung,
  speicherFehlerTitel,
  speicherFehlerFallback,
  card = true,
  einsatzId,
}: {
  senden: boolean;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  /**
   * Einsatz für die Katalogauswahl samt lesbarer Besetzung (LFH-549,
   * `fuehrung/useFunktionsVorschlaege.ts`). Ohne Angabe bleibt nur der Freitext. Geladen wird erst,
   * wenn das Formular steht — die Modale hängen es per `destroyOnHidden` nur geöffnet ein.
   */
  einsatzId?: number;
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
  /**
   * Die Anlege-Mutation, an die Erfassungshülle durchgereicht (LFH-1077): sie zeigt den Grund einer
   * Ablehnung im Formular und räumt ihn beim Einhängen und Abbrechen (Escape). Die Modal-Einbettungen
   * lassen sie weg.
   */
  speicherung?: Speicherung;
  speicherFehlerTitel?: string;
  speicherFehlerFallback?: string;
  /** Umschließendes Paneel mit Titel rendern. `false`, wo der Container den Titel schon liefert. */
  card?: boolean;
}) {
  const [form] = Form.useForm<FormWerte>();
  // Richtung steuert die Sichtbarkeit der externen Adressat-Felder.
  const richtung = Form.useWatch('richtung', form);
  // Tipptext des Empfängerfelds: speist „Fachberater: <Text>“/„Führungshilfspersonal: <Text>“.
  const [suche, setSuche] = useState('');
  const funktionen: FunktionsVorschlaege = useFunktionsVorschlaege(einsatzId);

  /*
   * Die Empfänger-Regeln zählen den externen Adressaten mit: ändern sich Richtung oder Bezeichnung,
   * prüft das Feld neu, aber erst, wenn es berührt ist oder sich schon gemeldet hat (nach einem
   * Absendeversuch). `dependencies` prüfte schon beim ersten Umschalten der Richtung und meldete
   * „Mindestens ein Empfänger“, bevor jemand absenden wollte.
   */
  const externBezeichnung = Form.useWatch('externBezeichnung', form);
  useEffect(() => {
    if (form.isFieldTouched('empfaenger') || form.getFieldError('empfaenger').length > 0)
      form.validateFields(['empfaenger']).catch(() => {});
  }, [richtung, externBezeichnung, form]);

  // initialText kann verzögert eintreffen (z. B. Heraufstufung) → ins Feld spiegeln.
  useEffect(() => {
    if (initialText) form.setFieldValue('text', initialText);
  }, [initialText, form]);

  /**
   * Das `return` ist tragend: die Hülle lässt die Felder stehen, wenn die Zusage bricht. Den
   * fehlenden Empfänger fängt die Regel am Feld ab (`pflichtEmpfaengerRegel`), hier kommt er nicht
   * mehr an.
   */
  const absenden = (w: FormWerte) => {
    const empfaenger = alleEmpfaenger(w, funktionen.katalog);
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
      frist_at: w.frist ? alsBackendZeit(w.frist) : undefined,
      erteilt_at: w.erteiltAm ? alsBackendZeit(w.erteiltAm) : undefined,
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
    { label: 'Funktionen', options: funktionsOptionen(funktionen, suche) },
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
          {/* Leer setzt der Server die Erteilzeit auf jetzt (`auftrag/eingabe.rs`). */}
          <Form.Item name="erteiltAm" label="Erteilt am (optional)">
            <ZeitpunktEingabe
              style={{ width: '100%' }}
              format="YYYY-MM-DD HH:mm"
              placeholder="jetzt"
            />
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
              <Input
                aria-label="Externe Bezeichnung"
                placeholder="z. B. Leitstelle Nord"
                maxLength={AUFTRAG_EXTERN_BEZEICHNUNG_MAX}
              />
            </Form.Item>
          </Col>
        </Row>
      )}
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="absicht" rules={[befehlsfeldRegel('Absicht')]} label="Absicht / Ziel">
            <TextArea aria-label="Absicht / Ziel" rows={1} count={BEFEHLSFELD_ZAEHLER} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="lage" rules={[befehlsfeldRegel('Lage')]} label="Lage">
            <TextArea aria-label="Lage" rows={1} count={BEFEHLSFELD_ZAEHLER} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} sm={8}>
          <Form.Item name="ort" rules={[befehlsfeldRegel('Ort')]} label="Ort / Wo">
            <Input aria-label="Ort / Wo" count={BEFEHLSFELD_ZAEHLER} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="zeit" rules={[befehlsfeldRegel('Zeit')]} label="Zeit / Wann">
            <Input
              aria-label="Zeit / Wann"
              placeholder="z. B. sofort, bis 14:00, nach Eintreffen"
              count={BEFEHLSFELD_ZAEHLER}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="mittel" rules={[befehlsfeldRegel('Mittel')]} label="Mittel / Womit">
            <Input aria-label="Mittel / Womit" count={BEFEHLSFELD_ZAEHLER} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="verbindung"
            rules={[befehlsfeldRegel('Verbindung')]}
            label="Verbindung / Meldewege"
          >
            <Input aria-label="Verbindung / Meldewege" count={BEFEHLSFELD_ZAEHLER} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            name="sicherheit"
            rules={[befehlsfeldRegel('Sicherheit')]}
            label="Sicherheit / Besonderes"
          >
            <Input aria-label="Sicherheit / Besonderes" count={BEFEHLSFELD_ZAEHLER} />
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
        erteiltAm: serverJetzt(),
      }}
      onErfassen={absenden}
      // Das Inline-Formular schließt nach dem Senden NICHT; in den Modal-Einbettungen schließt der
      // Aufrufer selbst.
      onFertig={onFertig ?? (() => {})}
      speicherung={speicherung}
      speicherFehlerTitel={speicherFehlerTitel}
      speicherFehlerFallback={speicherFehlerFallback}
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
        rules={[
          { required: true, message: 'Auftragstext ist erforderlich' },
          // Ein vorbelegter Text aus Meldung, Chat oder ETB über der Grenze wird nicht still
          // gekürzt: der Zähler zeigt die Überlänge, Senden scheitert hier (LFH-937, D8).
          zeichenRegel(AUFTRAG_TEXT_MAX, 'Auftragstext'),
        ]}
      >
        <TextArea aria-label="Auftrag / Was" rows={2} count={zeichenGrenze(AUFTRAG_TEXT_MAX)} />
      </Form.Item>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          {/* EIN Feld für beide Empfängersorten (Begründung an `FormWerte.empfaenger`). Das Komma bleibt
             Trennzeichen, damit „S3, Fachberater" zwei Empfänger ergibt. */}
          <Form.Item
            name="empfaenger"
            label="Empfänger"
            rules={[
              (f) => pflichtEmpfaengerRegel(funktionen.katalog, f),
              empfaengerRegel(funktionen.katalog),
              empfaengerAnzahlRegel,
            ]}
          >
            <Select
              mode="tags"
              aria-label="Empfänger"
              // Grenze des Servers vor dem Entdoppeln (LFH-937); kappt auch eine eingefügte Liste.
              maxCount={AUFTRAG_EMPFAENGER_MAX}
              options={zielOptionen}
              placeholder="Abschnitt, Einheit oder Funktion (z. B. S3)"
              allowClear
              tokenSeparators={[',']}
              onSearch={setSuche}
              onBlur={() => setSuche('')}
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
            <ZeitpunktEingabe style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
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
    <Paneel titel="Neuer Auftrag" koerperPolster>
      {formular}
    </Paneel>
  );
}
