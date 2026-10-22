import { AutoComplete, Button, Col, Collapse, Form, Input, Row, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type dayjs from 'dayjs';
import {
  ETB_PARTEI_MAX,
  NACHFORDERUNG_ART_MAX,
  NACHFORDERUNG_BEZEICHNUNG_MAX,
  NACHFORDERUNG_ZIEL_TEXT_MAX,
} from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPlus } from '../icons';
import { listeEinheitTypen } from '../api/einheitTypen';
import { globalKeys } from '../api/queryKeys';
import { MengenFeld } from '../components/MengenFeld';
import { ZeitpunktEingabe, useZeitEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
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
import { KennungsLink } from '../components/kennungsLink';
import { artOptionen, schnellwahlArten } from './artVorschlaege';
import {
  zielAusText,
  zielOptionen,
  zielVorgabe,
  type ZielAbschnitt,
  type ZielRaum,
} from './zielVorschlaege';

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
  /** Ziel/Meldeort als Name; beim Absenden Raum, Abschnitt oder Freitext ({@link zielAusText}). */
  wohin: string;
  bezeichnung: string;
  adressatKategorie: AdressatKategorie;
  adressatBezeichnung: string;
  prioritaet: NachforderungPrioritaet;
  benoetigtBis: dayjs.Dayjs | null;
  begruendung: string;
}

const PRIORITAET_OPTIONEN: { value: NachforderungPrioritaet; label: string }[] = [
  { value: 'sofort', label: 'Sofort' },
  { value: 'dringend', label: 'Dringend' },
  { value: 'normal', label: 'Normal' },
];

/**
 * Felder hinter „Weitere Angaben“ (LLH-1089, design.md D1). Scheitert die Prüfung an einem davon,
 * klappt der Teil auf.
 */
const EINGEKLAPPT = new Set<string>([
  'bezeichnung',
  'adressatKategorie',
  'adressatBezeichnung',
  'prioritaet',
  'benoetigtBis',
  'begruendung',
]);

/**
 * Stellenbezug einer neuen Nachforderung (LLH-1082, design.md D7): die Betreuungsstelle, für die
 * angefordert wird. `name` und `pfad` liest die Seite aus der Betreuungsübersicht; ohne sie steht
 * „Für eine Betreuungsstelle“, gesendet wird die Kennung trotzdem (der Server prüft sie).
 */
export interface NachforderungBezug {
  betreuungsstelleId: number;
  name?: string;
  /** Sprung auf die Seite der Stelle (der Weg zurück). */
  pfad?: string;
}

/** Vorbelegte Begründung eines Stellenbezugs; leer, solange der Name fehlt. */
export function bezugBegruendung(bezug: NachforderungBezug | null | undefined): string {
  return bezug?.name ? `Für Betreuungsstelle ${bezug.name}` : '';
}

/**
 * Wiederholfelder einer Serie: meist mehreres bei DERSELBEN Stelle an DENSELBEN Meldeort; Art,
 * Anzahl, Details und Bedarfszeit wechseln und werden geleert.
 */
const UEBERNAHME: (keyof FormWerte & string)[] = [
  'wohin',
  'adressatKategorie',
  'adressatBezeichnung',
  'prioritaet',
];

const KEINE_ARTEN: readonly string[] = [];
const KEINE_RAEUME: readonly ZielRaum[] = [];
const KEINE_ABSCHNITTE: readonly ZielAbschnitt[] = [];

export default function NachforderungFormular({
  senden,
  onAnlegen,
  card = true,
  vorbelegung,
  bezug,
  speicherung,
  fruehereArten = KEINE_ARTEN,
  orgArten = KEINE_ARTEN,
  raeume = KEINE_RAEUME,
  abschnitte = KEINE_ABSCHNITTE,
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
   * Stellenbezug (LLH-1082): steht über den Feldern, geht als `betreuungsstelle_id` mit und belegt
   * die Begründung „Für Betreuungsstelle …“ vor. Über die Startwerte, anders als die
   * `vorbelegung`: in einer Serie für dieselbe Stelle (Feldbetten, Decken, …) steht sie nach jedem
   * Absetzen wieder da; Art und Bezeichnung bleiben leer, eine Dublette entsteht so nicht.
   */
  bezug?: NachforderungBezug | null;
  /**
   * Die Anlege-Mutation: ihr Fehler steht im Formular bis zum nächsten Absetzen; Einhängen und
   * Abbrechen räumen ihn (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“).
   */
  speicherung?: Speicherung;
  /**
   * Arten der Nachforderungen dieses Einsatzes, häufigste zuerst (`fruehereArten`): Schnellwahl und
   * erste Vorschlagsgruppe für „Was“.
   */
  fruehereArten?: readonly string[];
  /**
   * Übliche Arten der Organisation aus Einsätzen, die der Benutzer lesen darf (LLH-1379): füllen
   * die Schnellwahl nach den Arten des Einsatzes und bilden die zweite Vorschlagsgruppe.
   */
  orgArten?: readonly string[];
  /** Bereitstellungsräume des Einsatzes für „Wohin“; leer ohne Freigabe des Moduls. */
  raeume?: readonly ZielRaum[];
  /** Einsatzabschnitte für „Wohin“; leer ohne Freigabe des Moduls. */
  abschnitte?: readonly ZielAbschnitt[];
}) {
  const [form] = Form.useForm<FormWerte>();
  const { formatiere } = useZeitEingabe();
  const [weitereOffen, setWeitereOffen] = useState(false);
  const anzahlRef = useRef<HTMLDivElement>(null);
  // Einheitstypen der Organisation (aktive, Folge `sortier`) als dritte Vorschlagsgruppe.
  const typen = useQuery({ queryKey: globalKeys.einheitTypen(), queryFn: listeEinheitTypen }).data;
  const schnellwahl = useMemo(
    () => schnellwahlArten(fruehereArten, orgArten),
    [fruehereArten, orgArten],
  );
  const artVorschlaege = useMemo(
    () => artOptionen(fruehereArten, typen ?? [], orgArten),
    [fruehereArten, typen, orgArten],
  );
  const wohinOptionen = useMemo(() => zielOptionen(raeume, abschnitte), [raeume, abschnitte]);
  const wohinVorgabe = zielVorgabe(raeume);
  // Katalog „Externe Stellen“ (LFH-1194, design.md D8): Vorschläge für die Adressat-Bezeichnung,
  // die zuständige Leitstelle als Vorgabe bei der Kategorie „Leitstelle“.
  const stellen = useExterneStellen().data;
  const stellenOptionen = externeStellenOptions(stellen ?? []);
  const vorgabeLeitstelle = zustaendigeLeitstelle(stellen ?? []) ?? '';
  const kategorie = Form.useWatch('adressatKategorie', form);
  const adressatBezeichnung = Form.useWatch('adressatBezeichnung', form);
  const prioritaet = Form.useWatch('prioritaet', form);
  const benoetigtBis = Form.useWatch('benoetigtBis', form);
  const details = Form.useWatch('bezeichnung', form);
  const begruendung = Form.useWatch('begruendung', form);

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

  // Wohin: der einzige aktive Bereitstellungsraum als Vorgabe, wie die Leitstelle oben: nur in ein
  // leeres, unberührtes Feld, sobald die Liste da ist. Den Reset decken die Startwerte ab.
  useEffect(() => {
    if (!wohinVorgabe) return;
    if (form.getFieldValue('wohin') || form.isFieldTouched('wohin')) return;
    form.setFieldValue('wohin', wohinVorgabe);
  }, [form, wohinVorgabe]);

  // Läuft nach dem Einhängen des `<Form>` und nur bei einer NEUEN Vorbelegung (die Seite hält
  // sie identitätsstabil).
  useEffect(() => {
    if (!vorbelegung) return;
    form.setFieldsValue({
      art: vorbelegung.art,
      // Eine Teil-Vorbelegung (LLH-1133) lässt beide leer: die Person trägt sie ein; die Vorgabe 1
      // gilt nur für die leere Maske.
      bezeichnung: vorbelegung.bezeichnung ?? '',
      anzahl: vorbelegung.anzahl ?? null,
      begruendung: vorbelegung.begruendung ?? '',
    });
  }, [form, vorbelegung]);

  // Der Name der Stelle kommt mit der Betreuungsübersicht, oft nach dem Einhängen: dann vorbelegen,
  // solange die Begründung leer und unberührt ist. Den Reset nach dem Absetzen decken die
  // Startwerte ab.
  const begruendungVorgabe = bezugBegruendung(bezug);
  useEffect(() => {
    if (!begruendungVorgabe) return;
    if (form.getFieldValue('begruendung') || form.isFieldTouched('begruendung')) return;
    form.setFieldValue('begruendung', begruendungVorgabe);
  }, [form, begruendungVorgabe]);

  /** Schnellwahl: setzt „Was“ und markiert die Anzahl, sodass eine Ziffer die Vorgabe ersetzt. */
  const waehle = (art: string) => {
    form.setFieldValue('art', art);
    const feld = anzahlRef.current?.querySelector('input');
    feld?.focus();
    feld?.select();
  };

  // Das `return` ist tragend: die Hülle wartet auf diese Zusage.
  const absenden = (w: FormWerte) => {
    return onAnlegen({
      art: w.art.trim(),
      bezeichnung: w.bezeichnung?.trim() || undefined,
      anzahl: w.anzahl ?? undefined,
      ...zielAusText(w.wohin, raeume, abschnitte),
      benoetigt_bis: w.benoetigtBis ? alsBackendZeit(w.benoetigtBis) : undefined,
      adressat_kategorie: w.adressatKategorie,
      adressat_bezeichnung: w.adressatBezeichnung?.trim() || undefined,
      begruendung: w.begruendung?.trim() || undefined,
      prioritaet: w.prioritaet,
      betreuungsstelle_id: bezug?.betreuungsstelleId,
    });
  };

  /** Jeder Wert, der von der Vorgabe abweicht, steht im Kopf — eingeklappt bleibt nichts verborgen. */
  const abweichungen = [
    kategorie && kategorie !== 'leitstelle'
      ? ADRESSAT_OPTIONEN.find((o) => o.value === kategorie)?.label
      : undefined,
    adressatBezeichnung?.trim() && adressatBezeichnung.trim() !== vorgabeLeitstelle
      ? adressatBezeichnung.trim()
      : undefined,
    // `useWatch` liefert im ersten Render `undefined`: ohne den Riegel stünde kurz „Priorität “ da.
    prioritaet && prioritaet !== 'normal'
      ? `Priorität ${PRIORITAET_OPTIONEN.find((o) => o.value === prioritaet)?.label ?? ''}`
      : undefined,
    benoetigtBis ? `bis ${formatiere(benoetigtBis, 'DD.MM. HH:mm')}` : undefined,
    details?.trim() ? 'Details' : undefined,
    begruendung?.trim() && begruendung.trim() !== begruendungVorgabe ? 'Begründung' : undefined,
  ].filter((t): t is string => !!t);

  const formular = (
    <ErfassungsFormular<FormWerte>
      form={form}
      initialValues={{
        art: '',
        anzahl: 1,
        wohin: wohinVorgabe,
        bezeichnung: '',
        adressatKategorie: 'leitstelle',
        adressatBezeichnung: vorgabeLeitstelle,
        prioritaet: 'normal',
        benoetigtBis: null,
        begruendung: begruendungVorgabe,
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
      onPruefungGescheitert={(felder) => {
        if (felder.some((f) => EINGEKLAPPT.has(f))) setWeitereOffen(true);
      }}
    >
      {bezug && (
        // Der Bezug ist keine Eingabe: er steht fest, solange die Erfassung offen ist. Der Name ist
        // der Weg zurück auf die Stelle.
        <Typography.Paragraph data-lfh="nachforderung-bezug" style={{ marginBottom: 12 }}>
          {bezug.name ? (
            <>
              Für Betreuungsstelle{' '}
              {bezug.pfad ? (
                <KennungsLink to={bezug.pfad}>
                  {bezug.name} <span aria-hidden="true">↗</span>
                </KennungsLink>
              ) : (
                <strong>{bezug.name}</strong>
              )}
            </>
          ) : (
            'Für eine Betreuungsstelle'
          )}
        </Typography.Paragraph>
      )}
      <Space role="group" aria-label="Schnellwahl" wrap style={{ marginBottom: 16 }}>
        {schnellwahl.map((art) => (
          <Button key={art} icon={<IconPlus />} onClick={() => waehle(art)}>
            {art}
          </Button>
        ))}
      </Space>
      <Row gutter={16}>
        <Col xs={24} sm={10}>
          <Form.Item
            name="art"
            label="Was"
            rules={[{ required: true, whitespace: true, message: 'Was ist erforderlich' }]}
          >
            <AutoComplete
              aria-label="Was"
              options={artVorschlaege}
              showSearch={teilwortSuche}
              placeholder="z. B. RTW, SEG, Sandsäcke"
              maxLength={NACHFORDERUNG_ART_MAX}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={4} ref={anzahlRef}>
          <Form.Item name="anzahl" label="Anzahl">
            <MengenFeld beschriftung="Anzahl" style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={10}>
          <Form.Item name="wohin" label="Wohin">
            <AutoComplete
              aria-label="Wohin"
              options={wohinOptionen}
              showSearch={teilwortSuche}
              allowClear
              placeholder="z. B. BR Nord"
              maxLength={NACHFORDERUNG_ZIEL_TEXT_MAX}
            />
          </Form.Item>
        </Col>
      </Row>
      {/* Feldbudget (LFH-974): sichtbar drei Felder. `forceRender`, damit Vorbelegung, Übernahme und
          Prüfung die Felder auch zugeklappt erreichen. */}
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
                <Form.Item name="bezeichnung" label="Details / Zweck">
                  <Input aria-label="Details / Zweck" maxLength={NACHFORDERUNG_BEZEICHNUNG_MAX} />
                </Form.Item>
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="adressatKategorie" label="Adressat">
                      <Select<AdressatKategorie>
                        aria-label="Adressat"
                        options={ADRESSAT_OPTIONEN}
                      />
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
                        aria-label="Priorität"
                        options={PRIORITAET_OPTIONEN}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="benoetigtBis" label="Benötigt bis">
                      <ZeitpunktEingabe
                        art="frist"
                        aria-label="Benötigt bis"
                        placeholder="sofort"
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item
                  name="begruendung"
                  label="Begründung / Lagebezug"
                  // Eine Vorbelegung aus der Verpflegung kann länger sein: sie bleibt stehen und
                  // sperrt.
                  rules={[zeichenRegel(ETB_PARTEI_MAX, 'Begründung')]}
                >
                  {/* Wächst bis vier Zeilen: eine Vorbelegung aus der Verpflegung ist mehrzeilig. */}
                  <TextArea
                    aria-label="Begründung / Lagebezug"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    count={zeichenGrenze(ETB_PARTEI_MAX)}
                  />
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
    <Paneel titel="Nachforderung absetzen" koerperPolster>
      {formular}
    </Paneel>
  );
}
