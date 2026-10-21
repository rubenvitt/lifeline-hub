import { IconBlitz, IconPapierflieger } from '../icons';
import { Button, Col, Collapse, Form, Input, InputNumber, Row, Space, Switch } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { ETB_INHALT_MAX, ETB_PARTEI_MAX } from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { ZeitpunktEingabe, useZeitEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { Paneel } from '../components/instrument';
import { Select } from '../components/Select';
import KoordinatenFeld from '../anzeige/KoordinatenFeld';
import { alsLatLon, type KoordinatenWert } from '../anzeige/koordinatenWert';
import { ErfassungsFormular, type Speicherung } from '../components/Erfassung';
import { useEffect, useMemo, useRef, useState } from 'react';
import type dayjs from 'dayjs';
import { serverJetzt } from '../offline/serveruhr';
import {
  KEINE_VORSCHLAEGE,
  optionsLabel,
  type FunktionsVorschlaege,
} from '../fuehrung/funktionsOptionenKern';
import type {
  Einheit,
  Einsatzabschnitt,
  Fuehrungsfunktion,
  Meldungsart,
  MeldungMeldeweg,
  MeldungPrioritaet,
  NeueMeldung,
  Richtung,
} from '../api/types';

const { TextArea } = Input;

interface MeldungFormWerte {
  /** Strukturierter Absender: `einheit:<id>` bzw. `abschnitt:<id>`, leer = frei. */
  von?: string;
  absender: string;
  empfaenger?: string;
  /** Empfängerfunktion aus dem Katalog (LLH-1214): ihre Nutzer bekommen „Neue Meldung“. */
  empfaenger_funktion?: Fuehrungsfunktion;
  meldeweg: MeldungMeldeweg;
  meldungsart: Meldungsart;
  prioritaet: MeldungPrioritaet;
  richtung: Richtung;
  ereigniszeit?: dayjs.Dayjs | null;
  inhalt: string;
  bestaetigung_pflicht: boolean;
  frist_min?: number | null;
  /** Verortung, nur bei der Art Lagemeldung gezeigt und gesendet (LLH-1031). */
  koord?: KoordinatenWert;
}

const DEFAULTS: MeldungFormWerte = {
  von: undefined,
  absender: '',
  empfaenger: '',
  empfaenger_funktion: undefined,
  meldeweg: 'funk',
  meldungsart: 'sonstige',
  prioritaet: 'normal',
  richtung: 'intern',
  ereigniszeit: null,
  inhalt: '',
  bestaetigung_pflicht: false,
  frist_min: null,
  koord: null,
};

/**
 * Wiederholfelder einer Meldungs-Serie: am Funkgerät wechselt der Wortlaut, nicht die
 * Gegenstelle. Absender, Meldeweg und Adressat bleiben; `inhalt` und `ereigniszeit` werden
 * geleert, weil ein stehengebliebener Wortlaut die nächste Meldung verfälschte.
 * `DEFAULTS` ist `initialValues` UND Reset-Ziel; die Übernahme läuft über das Re-Seeding der
 * Hülle, nicht über geänderte Defaults.
 */
const UEBERNAHME: (keyof MeldungFormWerte & string)[] = [
  'von',
  'absender',
  'meldeweg',
  'empfaenger',
  'empfaenger_funktion',
];

const MELDEWEG_OPTIONEN: { value: MeldungMeldeweg; label: string }[] = [
  { value: 'funk', label: 'Funk' },
  { value: 'telefon', label: 'Telefon' },
  { value: 'persoenlich', label: 'Persönlich' },
  { value: 'sonstige', label: 'Sonstige' },
];
const MELDUNGSART_OPTIONEN: { value: Meldungsart; label: string }[] = [
  { value: 'lagemeldung', label: 'Lagemeldung' },
  { value: 'sofortmeldung', label: 'Sofortmeldung' },
  { value: 'rueckmeldung', label: 'Rückmeldung' },
  { value: 'vollzugsmeldung', label: 'Vollzugsmeldung' },
  { value: 'anfrage', label: 'Anfrage' },
  { value: 'sonstige', label: 'Sonstige' },
];
const PRIORITAET_OPTIONEN: { value: MeldungPrioritaet; label: string }[] = [
  { value: 'sofort', label: 'Sofort' },
  { value: 'dringend', label: 'Dringend' },
  { value: 'normal', label: 'Normal' },
];
const RICHTUNG_OPTIONEN: { value: Richtung; label: string }[] = [
  { value: 'intern', label: 'Intern' },
  { value: 'extern', label: 'Extern' },
];

const etikett = <V extends string>(optionen: { value: V; label: string }[], v: V | undefined) =>
  optionen.find((o) => o.value === v)?.label;

/** Felder hinter „Weitere Angaben". Scheitert die Prüfung an einem davon, klappt der Teil auf. */
const EINGEKLAPPT = new Set<string>([
  'von',
  'meldeweg',
  'meldungsart',
  'prioritaet',
  'richtung',
  'ereigniszeit',
  'bestaetigung_pflicht',
  'frist_min',
  'koord',
]);

/** `einheit:<id>` / `abschnitt:<id>` → Bezugsfelder der Meldung. Unbekanntes → kein Bezug. */
export function vonZuBezug(
  von: string | undefined,
): Pick<NeueMeldung, 'einheit_id' | 'abschnitt_id'> {
  const m = /^(einheit|abschnitt):(\d+)$/.exec(von ?? '');
  if (!m) return {};
  const id = Number(m[2]);
  return m[1] === 'einheit' ? { einheit_id: id } : { abschnitt_id: id };
}

export default function MeldungFormular({
  senden,
  onAnlegen,
  card = true,
  einheiten = [],
  abschnitte = [],
  funktionsVorschlaege = KEINE_VORSCHLAEGE,
  speicherung,
  artVorgabe,
  serie = true,
  onFertig,
  einsatzId,
}: {
  senden: boolean;
  /**
   * Speichern. **Muss bei Ablehnung ablehnen** (`mutateAsync`) — nur dann lässt die
   * Erfassungshülle den Wortlaut stehen.
   */
  onAnlegen: (d: NeueMeldung) => Promise<unknown>;
  /** Umschließendes Paneel mit Titel rendern. `false`, wo der Container den Titel schon liefert. */
  card?: boolean;
  /** Auswahl für den strukturierten Absender. Leer ⇒ das Feld entfällt. */
  einheiten?: Einheit[];
  abschnitte?: Einsatzabschnitt[];
  /** Katalog der Führungsfunktionen für die Empfängerfunktion. Leer ⇒ das Feld entfällt. */
  funktionsVorschlaege?: FunktionsVorschlaege;
  /**
   * Die Anlege-Mutation, an die Erfassungshülle durchgereicht (LFH-1077): sie zeigt den Grund einer
   * Ablehnung im Formular und räumt ihn beim Einhängen und Abbrechen.
   */
  speicherung?: Speicherung;
  /**
   * Vorbelegte Meldungsart (LLH-1031: „Lagemeldung erfassen“ auf der Lage-Seite). Gilt für die
   * Startwerte UND das Reset-Ziel; die Vorbelegungsknöpfe entfallen, denn sie wechselten die Art.
   */
  artVorgabe?: Meldungsart;
  /** Serienmodus mit „Speichern und nächste“ (Vorgabe). `false`, wo nach dem Erfassen geschlossen wird. */
  serie?: boolean;
  /** Einzel-Erfassen erfolgreich (nur ohne Serie): der Aufrufer schließt. */
  onFertig?: () => void;
  /** Einsatz für die Ort-Zeile der Verortung (Peilung). */
  einsatzId?: number;
}) {
  const vorgaben = useMemo<MeldungFormWerte>(
    () => (artVorgabe ? { ...DEFAULTS, meldungsart: artVorgabe } : DEFAULTS),
    [artVorgabe],
  );
  const [form] = Form.useForm<MeldungFormWerte>();
  const meldungsart = Form.useWatch('meldungsart', form);
  const prioritaet = Form.useWatch('prioritaet', form);
  const bestaetigungPflicht = Form.useWatch('bestaetigung_pflicht', form);
  const von = Form.useWatch('von', form);
  const meldeweg = Form.useWatch('meldeweg', form);
  const richtung = Form.useWatch('richtung', form);
  const ereigniszeit = Form.useWatch('ereigniszeit', form);
  const fristMin = Form.useWatch('frist_min', form);
  const koord = Form.useWatch('koord', form);
  const istLagemeldung = meldungsart === 'lagemeldung';
  const { formatiere } = useZeitEingabe();
  const wortlautRef = useRef<TextAreaRef>(null);
  const [weitereOffen, setWeitereOffen] = useState(false);

  // Sofort (Art oder Priorität) ⇒ Bestätigungspflicht automatisch an; abwählbar.
  const istSofort = meldungsart === 'sofortmeldung' || prioritaet === 'sofort';
  useEffect(() => {
    if (istSofort) form.setFieldValue('bestaetigung_pflicht', true);
  }, [istSofort, form]);

  /** Fast-Path: Sofortmeldung vorbelegen (Art + Priorität sofort), Fokus auf den Wortlaut. */
  const sofortVorbelegen = () => {
    form.setFieldsValue({
      meldungsart: 'sofortmeldung',
      prioritaet: 'sofort',
      bestaetigung_pflicht: true,
    });
    wortlautRef.current?.focus();
  };

  /** Fast-Path: Lagemeldung an die übergeordnete Stelle (Art Lagemeldung, Richtung extern). */
  const lagemeldungVorbelegen = () => {
    form.setFieldsValue({ meldungsart: 'lagemeldung', richtung: 'extern' });
    wortlautRef.current?.focus();
  };

  // Das `return` ist tragend: die Hülle wartet auf diese Zusage und lässt die Felder bei
  // Ablehnung stehen.
  const absenden = (w: MeldungFormWerte) => {
    // Verortet wird beim Erfassen nur eine Lagemeldung (Server 422 sonst); ein Ort aus einer
    // vorher gewählten Art Lagemeldung geht nicht mit.
    const ort = w.meldungsart === 'lagemeldung' ? alsLatLon(w.koord) : null;
    return onAnlegen({
      ...vonZuBezug(w.von),
      absender: w.absender.trim(),
      empfaenger: w.empfaenger?.trim() || undefined,
      empfaenger_funktion: w.empfaenger_funktion,
      meldeweg: w.meldeweg,
      inhalt: w.inhalt.trim(),
      meldungsart: w.meldungsart,
      prioritaet: w.prioritaet,
      richtung: w.richtung,
      // Ereigniszeit Pflicht: leer ⇒ jetzt (Funk-Realität: meist „eben empfangen"), nach der
      // Serveruhr, sonst verschöbe eine vorgehende Geräteuhr auch die Rückmeldefrist (LFH-895).
      ereigniszeit: alsBackendZeit(w.ereigniszeit ?? serverJetzt()),
      bestaetigung_pflicht: w.bestaetigung_pflicht,
      bestaetigung_frist_min:
        w.bestaetigung_pflicht && w.frist_min != null ? w.frist_min : undefined,
      ...(ort ? { lat: ort.lat, lon: ort.lon } : {}),
    });
  };

  const vonOptionen = [
    {
      label: 'Einheiten',
      options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })),
    },
    {
      label: 'Einsatzabschnitte',
      options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })),
    },
  ].filter((g) => g.options.length > 0);
  const vonName = new Map(vonOptionen.flatMap((g) => g.options.map((o) => [o.value, o.label])));

  /** Wer eine Einheit wählt, bekommt ihren Namen als Absender vorbelegt — überschreibbar,
   *  denn der Funkrufname am Gerät ist oft genauer als der Einheitenname. */
  const vonGewaehlt = (von: string | undefined) => {
    const name = von ? vonName.get(von) : undefined;
    if (name) form.setFieldValue('absender', name);
  };

  // Nur Funktionen ohne Pflicht-Bezeichnung: Führungshilfspersonal und Fachberater nimmt eine
  // Meldung nicht an (der Server antwortet 422). S7 steht nur im Katalog, wenn eingeschaltet.
  const funktionsKatalog = funktionsVorschlaege.katalog.filter((e) => !e.bezeichnung_pflicht);
  const funktionsOptionen = funktionsKatalog.map((e) => ({
    value: e.funktion,
    label: optionsLabel(e, funktionsVorschlaege.besetzung),
  }));

  /** Eine gewählte Funktion füllt den freien Empfänger vor, solange er leer ist (design.md D8). */
  const funktionGewaehlt = (funktion: Fuehrungsfunktion | undefined) => {
    const eintrag = funktionsKatalog.find((e) => e.funktion === funktion);
    if (!eintrag || form.getFieldValue('empfaenger')?.trim()) return;
    form.setFieldValue('empfaenger', eintrag.kuerzel ?? eintrag.label);
  };

  /** Jeder Wert, der von der Vorgabe abweicht, steht im Kopf — eingeklappt bleibt nichts verborgen. */
  const abweichungen = [
    von ? vonName.get(von) : undefined,
    meldeweg !== vorgaben.meldeweg ? etikett(MELDEWEG_OPTIONEN, meldeweg) : undefined,
    meldungsart !== vorgaben.meldungsart ? etikett(MELDUNGSART_OPTIONEN, meldungsart) : undefined,
    // `useWatch` liefert im ersten Render `undefined`: ohne den Riegel stünde kurz „Priorität “ da.
    prioritaet && prioritaet !== vorgaben.prioritaet
      ? `Priorität ${etikett(PRIORITAET_OPTIONEN, prioritaet) ?? ''}`
      : undefined,
    richtung !== vorgaben.richtung ? etikett(RICHTUNG_OPTIONEN, richtung) : undefined,
    istLagemeldung && koord ? 'verortet' : undefined,
    ereigniszeit ? `Ereignis ${formatiere(ereigniszeit, 'DD.MM. HH:mm')}` : undefined,
    bestaetigungPflicht
      ? fristMin != null
        ? `Bestätigung ${fristMin} Min`
        : 'Bestätigung'
      : undefined,
  ].filter((t): t is string => !!t);

  const formular = (
    <ErfassungsFormular<MeldungFormWerte>
      form={form}
      initialValues={vorgaben}
      onErfassen={absenden}
      // Das Inline-Formular schließt nach dem Senden NICHT — Zuklappen ist ausdrückliche
      // Nutzeraktion. Die beiden Knöpfe unterscheiden sich nur in der Übernahme: „Meldung erfassen"
      // (auch Enter) leert alles, „Speichern und nächste" hält Absender/Meldeweg/Adressat. Ohne
      // Serie schließt der Aufrufer über `onFertig`.
      onFertig={onFertig ?? (() => {})}
      laeuft={senden}
      speicherung={speicherung}
      speicherFehlerTitel="Meldung nicht erfasst"
      speicherFehlerFallback="Erfassen fehlgeschlagen"
      erfassenText={artVorgabe === 'lagemeldung' ? 'Lagemeldung erfassen' : 'Meldung erfassen'}
      serie={serie}
      uebernahme={UEBERNAHME}
      onPruefungGescheitert={(felder) => {
        if (felder.some((f) => EINGEKLAPPT.has(f))) setWeitereOffen(true);
      }}
    >
      {/* Fast-Path im Formularkörper statt Card-extra, damit er auch bei `card={false}` erhalten bleibt. */}
      {!artVorgabe && (
        <Space style={{ marginBottom: 16 }} wrap>
          {/* Kein `danger` (LFH-962): der Knopf belegt nur Felder vor, und Rot bedient nichts. Die
            Dringlichkeit trägt das Prio-Etikett „Sofort". */}
          <Button icon={<IconBlitz />} onClick={sofortVorbelegen}>
            Sofortmeldung
          </Button>
          <Button icon={<IconPapierflieger />} onClick={lagemeldungVorbelegen}>
            Lagemeldung an übergeordnete Stelle
          </Button>
        </Space>
      )}
      <Form.Item
        name="inhalt"
        label="Inhalt / Wortlaut"
        rules={[
          { required: true, whitespace: true, message: 'Inhalt ist erforderlich' },
          zeichenRegel(ETB_INHALT_MAX, 'Inhalt'),
        ]}
      >
        {/* Ausdrückliches Fokusziel der Hülle: beim Öffnen und nach jedem Serien-Speichern. */}
        <TextArea
          ref={wortlautRef}
          data-erfassung-fokus
          aria-label="Inhalt / Wortlaut"
          rows={3}
          count={zeichenGrenze(ETB_INHALT_MAX)}
        />
      </Form.Item>
      <Row gutter={16}>
        <Col xs={24} sm={12} lg={funktionsOptionen.length > 0 ? 8 : 12}>
          <Form.Item
            name="absender"
            label="Absender (Funkrufname/Stelle)"
            rules={[{ required: true, whitespace: true, message: 'Absender ist erforderlich' }]}
          >
            <Input aria-label="Absender" maxLength={ETB_PARTEI_MAX} />
          </Form.Item>
        </Col>
        {funktionsOptionen.length > 0 && (
          <Col xs={24} sm={12} lg={8}>
            <Form.Item name="empfaenger_funktion" label="Empfängerfunktion">
              <Select<Fuehrungsfunktion>
                aria-label="Empfängerfunktion"
                allowClear
                placeholder="keine"
                options={funktionsOptionen}
                onChange={funktionGewaehlt}
              />
            </Form.Item>
          </Col>
        )}
        <Col xs={24} sm={12} lg={funktionsOptionen.length > 0 ? 8 : 12}>
          <Form.Item name="empfaenger" label="Empfänger / Adressat">
            <Input placeholder="z. B. ELW 1, S3" maxLength={ETB_PARTEI_MAX} />
          </Form.Item>
        </Col>
      </Row>
      {/* Feldbudget (LFH-974): eingeklappt drei Felder. `forceRender`, damit Vorbelegung, Übernahme
          und Prüfung die Felder auch zugeklappt erreichen. */}
      <Collapse
        ghost
        style={{ marginInline: -8 }}
        activeKey={weitereOffen ? ['weitere'] : []}
        onChange={(k) => setWeitereOffen(k.includes('weitere'))}
        items={[
          {
            key: 'weitere',
            forceRender: true,
            label: ['Weitere Angaben', ...abweichungen].join(' · '),
            children: (
              <>
                <Row gutter={16}>
                  {vonOptionen.length > 0 && (
                    <Col xs={24} sm={12}>
                      <Form.Item name="von" label="Von Einheit / Abschnitt">
                        <Select<string>
                          aria-label="Von Einheit / Abschnitt"
                          allowClear
                          placeholder="nicht zugeordnet"
                          options={vonOptionen}
                          onChange={vonGewaehlt}
                        />
                      </Form.Item>
                    </Col>
                  )}
                  <Col xs={24} sm={12}>
                    <Form.Item name="meldeweg" label="Meldeweg">
                      <Select<MeldungMeldeweg> options={MELDEWEG_OPTIONEN} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="meldungsart" label="Meldungsart">
                      <Select<Meldungsart> options={MELDUNGSART_OPTIONEN} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="prioritaet" label="Priorität">
                      <Select<MeldungPrioritaet> options={PRIORITAET_OPTIONEN} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="richtung" label="Richtung">
                      <Select<Richtung> aria-label="Richtung" options={RICHTUNG_OPTIONEN} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="ereigniszeit" label="Zeitpunkt des Ereignisses">
                      <ZeitpunktEingabe
                        art="ereignis"
                        style={{ width: '100%' }}
                        placeholder="jetzt"
                      />
                    </Form.Item>
                  </Col>
                </Row>
                {/* Eine Lagemeldung steht mit Ort auf der Lagekarte (LLH-1031); die Folge sichtbar
                    am Feld wie bei der Übernahme in die Lage. */}
                {istLagemeldung && (
                  <KoordinatenFeld
                    name="koord"
                    label="Verortung (optional)"
                    extra="Später nicht änderbar"
                    einsatzId={einsatzId}
                  />
                )}
                <Form.Item label="Bestätigung erforderlich (Sofortmeldung)">
                  {/* Flex statt `Space`: nur so trägt die Grundbreite des Fristfelds. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Form.Item name="bestaetigung_pflicht" valuePropName="checked" noStyle>
                      <Switch aria-label="Bestätigung erforderlich" />
                    </Form.Item>
                    {bestaetigungPflicht && (
                      <Form.Item
                        name="frist_min"
                        noStyle
                        // Der Server nimmt 1 bis 10080 Minuten an, wie bei den Default-Fristen.
                        // Als Regel statt `min`/`max` am Feld: das klemmte still, statt den Wert
                        // stehen zu lassen.
                        rules={[
                          { type: 'integer', min: 1, message: 'Frist mindestens 1 Min' },
                          { type: 'integer', max: 10080, message: 'Frist höchstens 10080 Min' },
                        ]}
                      >
                        <InputNumber
                          precision={0}
                          suffix="Min"
                          placeholder="Frist (Vorgabe)"
                          aria-label="Bestätigungsfrist in Minuten"
                          // Antds Vorgabebreite (90 px) schnitt den Platzhalter neben „Min“ zu
                          // „Frist (…“ ab (LFH-1151). Bis 200 px, am schmalen Schirm schmaler.
                          style={{ flex: '0 1 200px', minWidth: 0 }}
                        />
                      </Form.Item>
                    )}
                  </div>
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </ErfassungsFormular>
  );

  if (!card) return formular;
  return (
    <Paneel titel="Neue Meldung erfassen" koerperPolster>
      {formular}
    </Paneel>
  );
}
