import { Col, Collapse, Form, Input, Row, type FormInstance } from 'antd';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { serverJetzt } from '../offline/serveruhr';
import { Paneel } from '../components/instrument';
import { Select } from '../components/Select';
import { ErfassungsFormular, type Speicherung } from '../components/Erfassung';
import { useEffect, useState, type ReactNode } from 'react';
import type {
  AdressatKategorie,
  Auftrag,
  AuftragPatch,
  AuftragPrioritaet,
  NeuerAuftrag,
  Richtung,
} from '../api/types';
import { alleEmpfaenger, type FormWerte } from './auftragFormularKern';
import {
  buildEmpfaenger,
  EXTERN_KATEGORIE_OPTIONS,
  type ZielOption,
} from '../fuehrung/empfaengerKern';
import { EmpfaengerWahl } from '../fuehrung/EmpfaengerWahl';
import { berichtigungAus, vorbelegungAus } from './auftragBerichtigungKern';
import type { FunktionsVorschlaege } from '../fuehrung/funktionsOptionenKern';
import { useFunktionsVorschlaege } from '../fuehrung/useFunktionsVorschlaege';
import {
  AUFTRAG_BEFEHLSFELD_MAX,
  AUFTRAG_EMPFAENGER_MAX,
  AUFTRAG_EXTERN_BEZEICHNUNG_MAX,
  AUFTRAG_TEXT_MAX,
  FUNKTION_TEXT_MAX,
} from '../api/eingabegrenzen';
import { grenzeText, istZuLang, zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import {
  FORM_LABEL,
  KLAPPTEIL,
  KLAPPTEIL_HEADER,
  VALIDATION_NAME,
  klappteilFuer,
  type Klappteil,
  type SchemaFeld,
} from './auftragsschemaKern';

const { TextArea } = Input;

/** Die Optionen der Empfängerwahl; die Modale des Auftrags importieren sie von hier. */
export type { ZielOption };

/**
 * Freie Empfänger-Texte über der Grenze des Servers (`funktion_text`, LFH-937): der Tag-Modus hat
 * keinen Zähler, deshalb eine Regel statt eines stillen Kürzens.
 */
function empfaengerRegel(katalog: FunktionsVorschlaege['katalog']) {
  return {
    validator: (_: unknown, werte: unknown) =>
      Array.isArray(werte) &&
      buildEmpfaenger(werte as string[], katalog).some((e) =>
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

/** Zweck und Lage tragen oft mehr als eine Zeile, die übrigen Schemafelder sind kurz. */
const MULTILINE: ReadonlySet<SchemaFeld> = new Set(['lage', 'absicht']);

const PLACEHOLDER: Partial<Record<SchemaFeld, string>> = {
  zeit: 'z. B. sofort, bis 14:00, nach Eintreffen',
};

/** Ein Freitextfeld des Befehlsschemas mit Etikett, Zähler und Längenregel aus dem Kern. */
function SchemaFeldInput({ feld }: { feld: SchemaFeld }) {
  const label = FORM_LABEL[feld];
  return (
    <Form.Item
      name={feld}
      rules={[zeichenRegel(AUFTRAG_BEFEHLSFELD_MAX, VALIDATION_NAME[feld])]}
      label={label}
    >
      {MULTILINE.has(feld) ? (
        <TextArea aria-label={label} rows={1} count={BEFEHLSFELD_ZAEHLER} />
      ) : (
        <Input aria-label={label} placeholder={PLACEHOLDER[feld]} count={BEFEHLSFELD_ZAEHLER} />
      )}
    </Form.Item>
  );
}

/** Zwei Schemafelder nebeneinander, unter `sm` gestapelt. */
function SchemaRow({ links, rechts }: { links: SchemaFeld; rechts: SchemaFeld }) {
  return (
    <Row gutter={16}>
      <Col xs={24} sm={12}>
        <SchemaFeldInput feld={links} />
      </Col>
      <Col xs={24} sm={12}>
        <SchemaFeldInput feld={rechts} />
      </Col>
    </Row>
  );
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
  speicherung,
  speicherFehlerTitel,
  speicherFehlerFallback,
  card = true,
  einsatzId,
  berichtigen,
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
   * Ablehnung im Formular und räumt ihn beim Einhängen und Abbrechen (Escape).
   */
  speicherung?: Speicherung;
  speicherFehlerTitel?: string;
  speicherFehlerFallback?: string;
  /** Umschließendes Paneel mit Titel rendern. `false`, wo der Container den Titel schon liefert. */
  card?: boolean;
  /**
   * Berichtigen statt Erteilen (LLH-1098, design.md D9): dasselbe Formular, vorbelegt mit dem
   * Stand beim Öffnen; es sendet nur die geänderten Felder, ohne Änderung nichts. Richtung und
   * Erteilzeit stehen gesperrt, sie berichtigt der Server nicht. `onAnlegen` bleibt dann ungenutzt.
   */
  berichtigen?: {
    auftrag: Auftrag;
    /** **Muss bei Ablehnung ablehnen** (`mutateAsync`). */
    onSpeichern: (patch: AuftragPatch) => Promise<unknown>;
  };
}) {
  const [form] = Form.useForm<FormWerte>();
  // Richtung steuert die Sichtbarkeit der externen Adressat-Felder.
  const richtung = Form.useWatch('richtung', form);
  const funktionen: FunktionsVorschlaege = useFunktionsVorschlaege(einsatzId);
  // Die Vorbelegung gilt ab dem Öffnen: ein Live-Abgleich des Auftrags überschreibt keine Eingabe.
  const [vorbelegung] = useState(() => (berichtigen ? vorbelegungAus(berichtigen.auftrag) : null));
  // Kann das Formular einen Empfänger nicht abbilden, stehen alle Empfängerfelder gesperrt; ihre
  // Änderung fiele sonst still weg (der Patch schickt dann keine Empfänger).
  const empfaengerGesperrt = !!vorbelegung && !vorbelegung.empfaengerAenderbar;
  // Offene Klappteile: gesteuert, damit ein Prüffehler seinen Klappteil öffnen kann (D4).
  const [openKlappteile, setOpenKlappteile] = useState<Klappteil[]>([]);

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
    if (berichtigen && vorbelegung) {
      const patch = berichtigungAus(
        vorbelegung.werte,
        w,
        funktionen.katalog,
        vorbelegung.empfaengerAenderbar,
      );
      return Object.keys(patch).length === 0 ? Promise.resolve() : berichtigen.onSpeichern(patch);
    }
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
      weg: w.weg?.trim() || undefined,
      prioritaet: w.prioritaet,
      richtung: w.richtung,
      frist_at: w.frist ? alsBackendZeit(w.frist) : undefined,
      erteilt_at: w.erteiltAm ? alsBackendZeit(w.erteiltAm) : undefined,
      empfaenger,
    });
  };

  /**
   * Klappteil „Ausführung“: Mittel, Ziel, Weg, Zeit nach FwDV 100 (LLH-1091). Beide Klappteile
   * bewusst OHNE `forceRender`: nur so ist „im Ausgangszustand vier Felder“ samt Gegenprobe
   * („Aufklappen bringt die Felder“) prüfbar.
   */
  const ausfuehrungFelder = (
    <>
      <SchemaRow links="mittel" rechts="ort" />
      <SchemaRow links="weg" rechts="zeit" />
    </>
  );

  /**
   * Klappteil „Weitere Angaben“: Lage, Absicht, Meldewege, Sicherheit, dazu Richtung und
   * Erteilzeit. `richtung` steuert die Extern-Felder, geht aber mit, weil `intern` der Normalfall
   * ist; die Extern-Felder gehen MIT, sonst stünden sie sichtbar unter einem eingeklappten Auslöser.
   */
  const weitereFelder = (
    <>
      <SchemaRow links="lage" rechts="absicht" />
      <SchemaRow links="verbindung" rechts="sicherheit" />
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item name="richtung" label="Richtung">
            <Select<Richtung>
              aria-label="Richtung"
              disabled={!!berichtigen}
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
              art="ereignis"
              style={{ width: '100%' }}
              placeholder="jetzt"
              disabled={!!berichtigen}
            />
          </Form.Item>
        </Col>
      </Row>
      {richtung === 'extern' && (
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="externKategorie" label="Externe Stelle">
              <Select<AdressatKategorie>
                aria-label="Externe Stelle"
                options={EXTERN_KATEGORIE_OPTIONS}
                disabled={empfaengerGesperrt}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="externBezeichnung" label="Bezeichnung der Stelle">
              <Input
                aria-label="Externe Bezeichnung"
                placeholder="z. B. Leitstelle Nord"
                maxLength={AUFTRAG_EXTERN_BEZEICHNUNG_MAX}
                disabled={empfaengerGesperrt}
              />
            </Form.Item>
          </Col>
        </Row>
      )}
    </>
  );

  /** Ein Fehler hinter einem geschlossenen Kopf bliebe unsichtbar und sperrte das Senden (D4). */
  const openKlappteileWithErrors = (fehlerFelder: string[]) => {
    const affected = fehlerFelder.map(klappteilFuer).filter((k): k is Klappteil => k !== null);
    if (affected.length > 0) setOpenKlappteile((prev) => [...new Set([...prev, ...affected])]);
  };

  const formular = (
    <ErfassungsFormular<FormWerte>
      form={form}
      initialValues={
        vorbelegung?.werte ?? {
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
          weg: '',
          prioritaet: 'normal',
          richtung: 'intern',
          frist: null,
          erteiltAm: serverJetzt(),
        }
      }
      onErfassen={absenden}
      // Das Inline-Formular schließt nach dem Senden NICHT; in den Modal-Einbettungen schließt der
      // Aufrufer selbst.
      onFertig={onFertig ?? (() => {})}
      speicherung={speicherung}
      speicherFehlerTitel={speicherFehlerTitel}
      speicherFehlerFallback={speicherFehlerFallback}
      laeuft={senden}
      erfassenText={berichtigen ? 'Berichtigung speichern' : 'Auftrag erteilen'}
      serie={serie && !berichtigen}
      uebernahme={berichtigen ? undefined : UEBERNAHME}
      onPruefungGescheitert={openKlappteileWithErrors}
    >
      {zitat}
      {/* Reihenfolge der FwDV 100 (LLH-1091): Einheit vor Auftrag. Der Empfänger ist das erste Feld
          und bekommt den Fokus; EIN Feld für beide Empfängersorten (Begründung an
          `FormWerte.empfaenger`). Das Komma bleibt Trennzeichen, damit „S3, Fachberater" zwei
          Empfänger ergibt. */}
      <Form.Item
        name="empfaenger"
        label="Empfänger"
        // Ein Empfänger, den das Formular nicht abbildet (Person, Fahrzeug), sperrt das Feld;
        // der Grund steht sichtbar daran (LFH-1078).
        extra={empfaengerGesperrt ? 'Empfänger hier nicht änderbar' : undefined}
        rules={[
          (f) => pflichtEmpfaengerRegel(funktionen.katalog, f),
          empfaengerRegel(funktionen.katalog),
          empfaengerAnzahlRegel,
        ]}
      >
        <EmpfaengerWahl
          aria-label="Empfänger"
          disabled={empfaengerGesperrt}
          abschnitte={abschnitte}
          einheiten={einheiten}
          vorschlaege={funktionen}
          placeholder="Abschnitt, Einheit oder Funktion (z. B. S3)"
          // Bisheriges Verhalten des Auftrags: Verlassen übernimmt den Tipptext als Empfänger.
          commitSearchOnBlur
        />
      </Form.Item>
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
        <Col xs={24} sm={12}>
          <Form.Item name="frist" label="Frist (Quittung/Vollzug)">
            <ZeitpunktEingabe art="frist" style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
      <Collapse
        ghost
        style={{ marginInline: -8, marginBottom: 8 }}
        activeKey={openKlappteile}
        onChange={(k) => setOpenKlappteile((Array.isArray(k) ? k : [k]) as Klappteil[])}
        items={[
          {
            key: KLAPPTEIL.ausfuehrung,
            label: KLAPPTEIL_HEADER.ausfuehrung,
            children: ausfuehrungFelder,
          },
          {
            key: KLAPPTEIL.weitere,
            // Die Richtung geht mit „Werte behalten“ in den nächsten Auftrag; zugeklappt nennt der
            // Kopf die Abweichung von der Vorgabe „Intern“ (Erfassungs-Norm, `frontend/AGENTS.md`).
            label:
              richtung === 'extern'
                ? `${KLAPPTEIL_HEADER.weitere} · Richtung: Extern`
                : KLAPPTEIL_HEADER.weitere,
            children: weitereFelder,
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
