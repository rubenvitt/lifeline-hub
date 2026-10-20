import { Alert, Button, Checkbox, Collapse, Form, Input, InputNumber, Modal, Radio } from 'antd';
import { Typography } from 'antd';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { serverJetzt } from '../offline/serveruhr';
import type { Dayjs } from 'dayjs';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  Betreuungsstelle,
  BetreuungsstelleArt,
  BetreuungsstelleEingabe,
  BetreuungsstellePatch,
  BetreuungsstelleStatus,
  BelegungsmeldungEingabe,
  Erhebung,
  Evakuierungsbezirk,
  EvakuierungsbezirkEingabe,
  EvakuierungsbezirkPatch,
  Raeumungszustand,
  StandmeldungEingabe,
} from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { sprungGesperrtText } from '../components/Sprung';
import { Segmentleiste, type SegmentOption } from '../components/instrument';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { BETREUUNG_ERREICHBARKEIT_MAX, BETREUUNG_LEITUNG_MAX } from '../api/eingabegrenzen';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { raeumungszustand } from '../theme/statusFarben';
import {
  ART_LABEL,
  ERHEBUNG_LABEL,
  RAEUMUNG_FOLGE,
  evakuiertText,
  personenZahl,
} from './betreuungText';

/**
 * Die Erfassungsmasken des Fachmoduls Betreuung, alle auf `ErfassungsModal`.
 *
 * FELDBUDGET: höchstens drei Felder sichtbar, der Rest unter „Weitere Angaben" in einem
 * `Collapse` mit `forceRender` (sonst fehlen die Werte in `onFinish`).
 *
 * ZEIT: ein LEERES Zeitfeld heißt „jetzt" und lässt den Schlüssel weg — der Server setzt die
 * Zeit. `alsBackendZeit(dayjs())` hieße, der Client-Uhr zu vertrauen; geht sie über 60 s vor,
 * antwortet der Server mit 400.
 *
 * PATCH: nur geänderte Schlüssel. `null` bedeutet „leeren" und entsteht nur, wo vorher ein
 * Wert stand.
 *
 * AKTUELLER STAND: die Bearbeiten-Dialoge bekommen den Datensatz, wie er JETZT im Cache steht
 * (Live-Refetch bei offenem Dialog); die Formularwerte frieren beim Öffnen ein.
 * - Räumung hat EIN Feld, und es ist die Absicht → Vergleich gegen den aktuellen Stand, und das
 *   UNBERÜHRTE Radio folgt dem Live-Stand. Sonst ginge „zurück auf angeordnet" nach einem
 *   fremden Wechsel verloren, oder ein Speichern ohne Berührung schriebe den alten Zustand zurück.
 * - Die Mehrfeld-Dialoge vergleichen DREISEITIG (`…PatchDreiseitig`): ein Schlüssel geht nur
 *   raus, wenn die Person ihn geändert hat UND er vom aktuellen Stand abweicht — sonst
 *   überschriebe ein unberührtes Feld eine fremde Änderung (es gibt keinen CAS).
 * - Ob eine Leermeldung nötig ist, entscheidet die AKTUELLE Belegung (sonst 422).
 */

interface AbschnittOption {
  value: number;
  label: string;
}

// ── Reine Abbildungen: exportiert und direkt getestet ───────────────────────────────────

/** Getrimmter Text oder `null` — ein Feld aus Leerzeichen ist leer. */
function text(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/** Nur gesetzte Freitexte in den Anlage-Body; leere fehlen ganz. */
function optionaleTexte<K extends string>(
  werte: Partial<Record<K, string | null | undefined>>,
): Partial<Record<K, string>> {
  const aus: Partial<Record<K, string>> = {};
  for (const k of Object.keys(werte) as K[]) {
    const t = text(werte[k]);
    if (t != null) aus[k] = t;
  }
  return aus;
}

/** Zeitpunkt aus dem Feld → Wire; leer → kein Schlüssel. */
function zeitpunkt(z: Dayjs | null | undefined): { zeitpunkt_at?: string } {
  return z ? { zeitpunkt_at: alsBackendZeit(z) } : {};
}

interface StandWerte {
  evakuiert: number;
  erhebung: Erhebung;
  zeitpunkt?: Dayjs | null;
}

export function standBody(w: StandWerte): StandmeldungEingabe {
  return { evakuiert: w.evakuiert, erhebung: w.erhebung, ...zeitpunkt(w.zeitpunkt) };
}

interface BelegungWerte {
  belegt: number;
  zeitpunkt?: Dayjs | null;
}

export function belegungBody(w: BelegungWerte): BelegungsmeldungEingabe {
  return { belegt: w.belegt, ...zeitpunkt(w.zeitpunkt) };
}

/**
 * Gebiet beim Anlegen (LLH-1069): „Keins“ oder gleich danach eine Fläche auf der Lagekarte zeichnen.
 * „Radius“ kommt dazu, sobald die Karte einen Kreis um einen Punkt zeichnen kann (LLH-1043).
 */
export type GebietWahl = 'keins' | 'flaeche';

export interface BezirkWerte {
  bezeichnung: string;
  plan_personen: number;
  plan_erhebung: Erhebung;
  /** Nur im Anlegedialog; die Bearbeitung kennt keine Gebietswahl. */
  gebiet?: GebietWahl;
  abschnitt_id?: number | null;
  sammelstelle?: string | null;
  notiz?: string | null;
}

function bezirkAnlegenBody(w: BezirkWerte): EvakuierungsbezirkEingabe {
  return {
    bezeichnung: w.bezeichnung.trim(),
    plan_personen: w.plan_personen,
    plan_erhebung: w.plan_erhebung,
    ...(w.abschnitt_id != null ? { abschnitt_id: w.abschnitt_id } : {}),
    ...optionaleTexte({ sammelstelle: w.sammelstelle, notiz: w.notiz }),
  };
}

/**
 * Setzt `patch[k]`, wenn sich der Wert gegenüber `alt` ändert. `undefined` wird zu `null`: ein
 * geleertes Auswahlfeld liefert `undefined`, das beim Serialisieren wegfiele — der Abschnitt
 * bliebe gesetzt.
 */
function wennGeaendert<P, K extends keyof P>(
  patch: P,
  k: K,
  alt: P[K] | null | undefined,
  neu: P[K] | null | undefined,
) {
  if ((alt ?? null) !== (neu ?? null)) patch[k] = (neu ?? null) as P[K];
}

export function bezirkPatch(vorher: Evakuierungsbezirk, w: BezirkWerte): EvakuierungsbezirkPatch {
  const patch: EvakuierungsbezirkPatch = {};
  const bezeichnung = text(w.bezeichnung);
  if (bezeichnung != null && bezeichnung !== vorher.bezeichnung) patch.bezeichnung = bezeichnung;
  wennGeaendert(patch, 'plan_personen', vorher.plan_personen, w.plan_personen);
  wennGeaendert(patch, 'plan_erhebung', vorher.plan_erhebung, w.plan_erhebung);
  wennGeaendert(patch, 'abschnitt_id', vorher.abschnitt_id, w.abschnitt_id);
  wennGeaendert(patch, 'sammelstelle', vorher.sammelstelle, text(w.sammelstelle));
  wennGeaendert(patch, 'notiz', vorher.notiz, text(w.notiz));
  return patch;
}

export interface StelleWerte {
  bezeichnung: string;
  art: BetreuungsstelleArt;
  status?: BetreuungsstelleStatus;
  kapazitaet_personen?: number | null;
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
  leitung?: string | null;
  erreichbarkeit?: string | null;
}

function stelleAnlegenBody(w: StelleWerte): BetreuungsstelleEingabe {
  return {
    bezeichnung: w.bezeichnung.trim(),
    art: w.art,
    ...(w.kapazitaet_personen != null ? { kapazitaet_personen: w.kapazitaet_personen } : {}),
    ...(w.abschnitt_id != null ? { abschnitt_id: w.abschnitt_id } : {}),
    ...optionaleTexte({
      standort: w.standort,
      notiz: w.notiz,
      leitung: w.leitung,
      erreichbarkeit: w.erreichbarkeit,
    }),
  };
}

export function stellePatch(vorher: Betreuungsstelle, w: StelleWerte): BetreuungsstellePatch {
  const patch: BetreuungsstellePatch = {};
  const bezeichnung = text(w.bezeichnung);
  if (bezeichnung != null && bezeichnung !== vorher.bezeichnung) patch.bezeichnung = bezeichnung;
  wennGeaendert(patch, 'art', vorher.art, w.art);
  if (w.status != null) wennGeaendert(patch, 'status', vorher.status, w.status);
  // `null` heißt hier „keine Kapazität" — und damit auch keine Zahl freier Plätze.
  wennGeaendert(patch, 'kapazitaet_personen', vorher.kapazitaet_personen, w.kapazitaet_personen);
  wennGeaendert(patch, 'abschnitt_id', vorher.abschnitt_id, w.abschnitt_id);
  wennGeaendert(patch, 'standort', vorher.standort, text(w.standort));
  wennGeaendert(patch, 'notiz', vorher.notiz, text(w.notiz));
  // Nur Felder, die das Formular trägt: fehlt der Schlüssel in den Werten, bleibt er unberührt.
  if ('leitung' in w) wennGeaendert(patch, 'leitung', vorher.leitung, text(w.leitung));
  if ('erreichbarkeit' in w) {
    wennGeaendert(patch, 'erreichbarkeit', vorher.erreichbarkeit, text(w.erreichbarkeit));
  }
  return patch;
}

/**
 * Nur die Schlüssel, die in BEIDEN Diffs stehen: gegen den Stand beim Öffnen (die Person hat
 * geändert) und gegen den aktuellen (der Server trägt den Wert noch nicht).
 */
function dreiseitig<P extends object>(eigeneAenderung: P, gegenAktuell: P): P {
  const patch = {} as P;
  for (const k of Object.keys(gegenAktuell) as (keyof P)[]) {
    if (k in eigeneAenderung) patch[k] = gegenAktuell[k];
  }
  return patch;
}

/**
 * Seit LLH-1076 Rechenweg der Stammdaten auf der Detailseite eines Bezirks
 * (`betreuung/BezirkStammdaten.tsx`); der Bearbeiten-Dialog ist entfallen.
 */
export function bezirkPatchDreiseitig(
  beimOeffnen: Evakuierungsbezirk,
  aktuell: Evakuierungsbezirk,
  w: BezirkWerte,
): EvakuierungsbezirkPatch {
  return dreiseitig(bezirkPatch(beimOeffnen, w), bezirkPatch(aktuell, w));
}

export function stellePatchDreiseitig(
  beimOeffnen: Betreuungsstelle,
  aktuell: Betreuungsstelle,
  w: StelleWerte,
): BetreuungsstellePatch {
  return dreiseitig(stellePatch(beimOeffnen, w), stellePatch(aktuell, w));
}

/** Ein leerer PATCH wird nicht gesendet — der Dialog schließt, als wäre gespeichert. */
function nurWennGeaendert<P extends object>(
  patch: P,
  senden: (p: P) => Promise<unknown>,
): Promise<unknown> {
  return Object.keys(patch).length === 0 ? Promise.resolve() : senden(patch);
}

// ── Bausteine ───────────────────────────────────────────────────────────────────────────

const ERHEBUNG_OPTIONEN = (['gezaehlt', 'geschaetzt'] as const).map((e) => ({
  value: e,
  label: ERHEBUNG_LABEL[e],
}));

export const ART_OPTIONEN = (Object.keys(ART_LABEL) as BetreuungsstelleArt[]).map((a) => ({
  value: a,
  label: ART_LABEL[a],
}));

/**
 * Kein Zeitpunkt in der Zukunft — der Server duldet 60 s Uhrenversatz, mehr ist 400. Gemessen an
 * der Serveruhr wie „Jetzt“, sonst fiele „Jetzt“ auf einem nachgehenden Gerät durch (LFH-895).
 */
const zeitRegel = {
  validator: (_: unknown, v: Dayjs | null | undefined) =>
    v && v.isAfter(serverJetzt().add(1, 'minute'))
      ? Promise.reject(new Error('Der Zeitpunkt liegt in der Zukunft.'))
      : Promise.resolve(),
};

/**
 * Obergrenze je Personenzahl, gespiegelt aus `betreuung::MAX_PERSONEN` (darüber 400). Als Regel,
 * NICHT als `max` am `InputNumber`: das klemmte still auf die Grenze.
 */
const MAX_PERSONEN = 1_000_000;

export const hoechstensRegel = {
  type: 'number' as const,
  max: MAX_PERSONEN,
  message: `Höchstens ${personenZahl(MAX_PERSONEN)} Personen`,
};

function erhebungFeld(name: string, label: string) {
  return (
    <Form.Item name={name} label={label} rules={[{ required: true }]}>
      {/* `name` ausdrücklich: zwei Radio-Gruppen ohne Namen gruppierte der Browser nativ zu EINER. */}
      <Radio.Group name={name} optionType="button" options={ERHEBUNG_OPTIONEN} />
    </Form.Item>
  );
}

function personenFeld(name: string, label: string, min: number, pflicht: boolean) {
  return (
    <Form.Item
      name={name}
      label={label}
      rules={[
        ...(pflicht ? [{ required: true, message: 'Bitte eine Anzahl angeben' }] : []),
        hoechstensRegel,
      ]}
    >
      <InputNumber min={min} precision={0} style={{ width: '100%' }} />
    </Form.Item>
  );
}

function zeitpunktFeld() {
  return (
    <Form.Item name="zeitpunkt" label="Zeitpunkt" rules={[zeitRegel]} style={{ marginBottom: 0 }}>
      {/* Uhrzeit und Kalendertag in der Anzeigezone (LFH-692); `zeitRegel` prüft den Zeitpunkt. */}
      <ZeitpunktEingabe
        art="ereignis"
        placeholder="jetzt"
        keineZukunftstage
        style={{ width: '100%' }}
      />
    </Form.Item>
  );
}

function abschnittFeld(abschnitte: readonly AbschnittOption[]) {
  return (
    <Form.Item name="abschnitt_id" label="Einsatzabschnitt">
      <Select
        allowClear
        placeholder="ohne Abschnitt"
        options={[...abschnitte]}
        notFoundContent="Keine Einsatzabschnitte angelegt"
      />
    </Form.Item>
  );
}

/** „Weitere Angaben" — `forceRender` ist TRAGEND (sonst fehlen die Werte in `onFinish`). */
function weitere(children: ReactNode) {
  return (
    <Collapse
      ghost
      items={[{ key: 'weitere', label: 'Weitere Angaben', forceRender: true, children }]}
    />
  );
}

interface DialogBasis {
  laeuft: boolean;
  /** `mutation.error` — steht IM Dialog, bis zum nächsten Absenden. */
  fehler: unknown;
  onSchliessen: () => void;
}

// ── Evakuierungsbezirk ──────────────────────────────────────────────────────────────────

/**
 * Die Gebietswahl als Formularfeld (`Form.Item` reicht `value`/`onChange` hinein). Ist die Lagekarte
 * gesperrt, steht „Fläche zeichnen“ gesperrt und nennt den Grund im Wortlaut (LFH-888) — ein
 * Tooltip allein erreichte Tablet und Handy nicht.
 */
function GebietFeld({
  value,
  onChange,
  karteGesperrt,
}: {
  value?: GebietWahl;
  onChange?: (wahl: GebietWahl) => void;
  karteGesperrt: boolean;
}) {
  const optionen: SegmentOption<GebietWahl>[] = [
    { wert: 'keins', label: 'Keins' },
    karteGesperrt
      ? {
          wert: 'flaeche',
          label: sprungGesperrtText('Fläche zeichnen'),
          gesperrt: KEINE_BERECHTIGUNG,
        }
      : { wert: 'flaeche', label: 'Fläche zeichnen' },
  ];
  return (
    <Segmentleiste<GebietWahl>
      beschriftung="Gebiet auf der Lagekarte"
      wert={value ?? 'keins'}
      onWechsel={(wahl) => onChange?.(wahl)}
      optionen={optionen}
    />
  );
}

export function BezirkAnlegenDialog({
  abschnitte,
  karteGesperrt,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: DialogBasis & {
  abschnitte: readonly AbschnittOption[];
  /** Modul Lagekarte für diese Person gesperrt (`useSprungSperre`): kein Zeichnen danach. */
  karteGesperrt: boolean;
  /** `gebiet`: was nach dem Anlegen geschieht (LLH-1069); der Server sieht es nicht. */
  onErfassen: (body: EvakuierungsbezirkEingabe, gebiet: GebietWahl) => Promise<unknown>;
}) {
  const [form] = Form.useForm<BezirkWerte>();
  return (
    <ErfassungsModal<BezirkWerte>
      offen
      titel="Evakuierungsbezirk anlegen"
      form={form}
      erfassenText="Anlegen"
      laeuft={laeuft}
      // Eine Plangröße ist zu Beginn meist geschätzt; die Erhebung ist sichtbar, der Vorgabewert also
      // nie still. Das Gebiet wird gleich gezeichnet, wenn die Karte frei ist (LLH-1069).
      initialValues={{ plan_erhebung: 'geschaetzt', gebiet: karteGesperrt ? 'keins' : 'flaeche' }}
      onErfassen={(w) => onErfassen(bezirkAnlegenBody(w), w.gebiet ?? 'keins')}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        name="bezeichnung"
        label="Bezeichnung"
        // Datenschutz: die Bezeichnung steht im Einsatztagebuch.
        extra="Keine Namen von Bewohnern."
        rules={[{ required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' }]}
      >
        <Input placeholder="z. B. Lindenstr. 1–20 oder Bezirk 3" />
      </Form.Item>
      {personenFeld('plan_personen', 'Plangröße (Personen)', 1, true)}
      {erhebungFeld('plan_erhebung', 'Erhebung')}
      <Form.Item name="gebiet" label="Gebiet auf der Lagekarte">
        <GebietFeld karteGesperrt={karteGesperrt} />
      </Form.Item>
      {weitere(
        <>
          {abschnittFeld(abschnitte)}
          <Form.Item name="sammelstelle" label="Sammelstelle">
            <Input />
          </Form.Item>
          <Form.Item name="notiz" label="Notiz" style={{ marginBottom: 0 }}>
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
        </>,
      )}
      <SpeicherFehler fehler={fehler} titel="Bezirk konnte nicht angelegt werden" />
    </ErfassungsModal>
  );
}

interface RaeumungWerte {
  raeumung: Raeumungszustand;
}

/**
 * Räumungszustand setzen. Umkehrbar — keine Rückfrage.
 * Verglichen wird gegen den AKTUELLEN Zustand, und das Radio folgt ihm, solange es unberührt
 * ist: ein Klick auf das schon gewählte Radio löst keinen Wechsel aus, und ein gewohnheitsmäßiges
 * Speichern drehte sonst eine fremd gemeldete Räumung samt ETB-Eintrag zurück. Eine eigene
 * Wahl bleibt stehen.
 */
export function RaeumungDialog({
  bezirk,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: DialogBasis & {
  /** Der AKTUELLE Stand aus dem Cache — nicht der beim Öffnen. */
  bezirk: Evakuierungsbezirk;
  onErfassen: (patch: EvakuierungsbezirkPatch) => Promise<unknown>;
}) {
  const [form] = Form.useForm<RaeumungWerte>();
  const [beimOeffnen] = useState(bezirk);
  const gesehen = useRef(bezirk.raeumung);
  useEffect(() => {
    // Nur auf einen WECHSEL reagieren: beim Einhängen trägt `initialValues` den Wert schon.
    if (gesehen.current === bezirk.raeumung) return;
    gesehen.current = bezirk.raeumung;
    if (!form.isFieldTouched('raeumung')) form.setFieldsValue({ raeumung: bezirk.raeumung });
  }, [form, bezirk.raeumung]);
  return (
    <ErfassungsModal<RaeumungWerte>
      offen
      titel={`Räumung: ${bezirk.bezeichnung}`}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      initialValues={{ raeumung: beimOeffnen.raeumung }}
      onErfassen={(w) =>
        nurWennGeaendert(w.raeumung !== bezirk.raeumung ? { raeumung: w.raeumung } : {}, onErfassen)
      }
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item name="raeumung" label="Räumungszustand" rules={[{ required: true }]}>
        <Radio.Group
          name="raeumung"
          optionType="button"
          options={RAEUMUNG_FOLGE.map((r) => ({ value: r, label: raeumungszustand[r].label }))}
        />
      </Form.Item>
      <SpeicherFehler fehler={fehler} titel="Räumungszustand konnte nicht gespeichert werden" />
    </ErfassungsModal>
  );
}

export function StandMeldenDialog({
  bezirk,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: DialogBasis & {
  bezirk: Evakuierungsbezirk;
  onErfassen: (body: StandmeldungEingabe) => Promise<unknown>;
}) {
  const [form] = Form.useForm<StandWerte>();
  return (
    <ErfassungsModal<StandWerte>
      offen
      titel={`Stand melden: ${bezirk.bezeichnung}`}
      form={form}
      erfassenText="Melden"
      laeuft={laeuft}
      // Gemeldet wird meist an der Sammelstelle, dort wird gezählt. Sichtbar umschaltbar.
      initialValues={{ erhebung: 'gezaehlt' }}
      onErfassen={(w) => onErfassen(standBody(w))}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Typography.Paragraph type="secondary">Bisher: {evakuiertText(bezirk)}</Typography.Paragraph>
      {/* „gesamt“: gemeldet wird die Gesamtzahl, nicht der Zuwachs. */}
      {personenFeld('evakuiert', 'Evakuiert gesamt (Personen)', 0, true)}
      {erhebungFeld('erhebung', 'Erhebung')}
      {weitere(zeitpunktFeld())}
      <SpeicherFehler fehler={fehler} titel="Stand konnte nicht gemeldet werden" />
    </ErfassungsModal>
  );
}

// ── Betreuungsstelle ────────────────────────────────────────────────────────────────────

export function StelleAnlegenDialog({
  abschnitte,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: DialogBasis & {
  abschnitte: readonly AbschnittOption[];
  onErfassen: (body: BetreuungsstelleEingabe) => Promise<unknown>;
}) {
  const [form] = Form.useForm<StelleWerte>();
  return (
    <ErfassungsModal<StelleWerte>
      offen
      titel="Betreuungsstelle anlegen"
      form={form}
      erfassenText="Anlegen"
      laeuft={laeuft}
      initialValues={{ art: 'betreuungsstelle' }}
      onErfassen={(w) => onErfassen(stelleAnlegenBody(w))}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        name="bezeichnung"
        label="Bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' }]}
      >
        <Input />
      </Form.Item>
      <Form.Item name="art" label="Art" rules={[{ required: true }]}>
        <Select options={ART_OPTIONEN} />
      </Form.Item>
      <Form.Item name="kapazitaet_personen" label="Kapazität (Personen)" rules={[hoechstensRegel]}>
        {/* Leer: keine Kapazität, dann auch keine Zahl freier Plätze. */}
        <InputNumber min={1} precision={0} placeholder="keine Angabe" style={{ width: '100%' }} />
      </Form.Item>
      {weitere(
        <>
          {abschnittFeld(abschnitte)}
          <Form.Item name="standort" label="Standort">
            <Input />
          </Form.Item>
          <Form.Item
            name="leitung"
            label="Leitung"
            rules={[zeichenRegel(BETREUUNG_LEITUNG_MAX, 'Leitung')]}
          >
            <Input count={zeichenGrenze(BETREUUNG_LEITUNG_MAX)} />
          </Form.Item>
          <Form.Item
            name="erreichbarkeit"
            label="Erreichbarkeit"
            rules={[zeichenRegel(BETREUUNG_ERREICHBARKEIT_MAX, 'Erreichbarkeit')]}
          >
            <Input count={zeichenGrenze(BETREUUNG_ERREICHBARKEIT_MAX)} />
          </Form.Item>
          <Form.Item name="notiz" label="Notiz" style={{ marginBottom: 0 }}>
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
        </>,
      )}
      <SpeicherFehler fehler={fehler} titel="Betreuungsstelle konnte nicht angelegt werden" />
    </ErfassungsModal>
  );
}

interface StelleSchliessenWerte {
  leermeldung?: boolean;
}

/**
 * Schließen einer BELEGTEN Stelle (LLH-1044, Knopf „Schließen" der Detailseite): der Server
 * verlangt Belegung 0. Der Dialog bietet die Leermeldung als ausdrückliches Häkchen an, nicht als
 * stille Vorgabe — eine ungemeldete „0" wäre eine erfundene Zahl. Erst die Meldung, dann der
 * Status.
 *
 * Gerechnet wird gegen den AKTUELLEN Stand: hat inzwischen jemand geleert, entfällt das Häkchen;
 * hat jemand geschlossen, geht nichts mehr hinaus.
 *
 * Scheitert der zweite Aufruf, darf ein neuer Versuch die 0 nicht noch einmal melden (doppelt
 * im ETB). Der Merker hält deshalb die Belegungsmeldung fest, gegen die geleert wurde: meldet
 * danach jemand anderes wieder Personen, gilt der Haken neu.
 */
export function StelleSchliessenDialog({
  stelle,
  laeuft,
  fehler,
  onErfassen,
  onLeermeldung,
  onSchliessen,
}: DialogBasis & {
  /** Der AKTUELLE Stand aus dem Cache — nicht der beim Öffnen. */
  stelle: Betreuungsstelle;
  onErfassen: (patch: BetreuungsstellePatch) => Promise<unknown>;
  /** Meldet Belegung 0 (ohne Zeitpunkt = jetzt). */
  onLeermeldung: () => Promise<unknown>;
}) {
  const [form] = Form.useForm<StelleSchliessenWerte>();
  const geleertGegen = useRef<number | null>(null);
  const belegt = stelle.belegung?.belegt ?? 0;
  const schonGeschlossen = stelle.status === 'geschlossen';
  const brauchtLeermeldung = !schonGeschlossen && belegt > 0;

  return (
    <ErfassungsModal<StelleSchliessenWerte>
      offen
      titel={`Betreuungsstelle ${stelle.bezeichnung} schließen`}
      form={form}
      erfassenText="Stelle schließen"
      laeuft={laeuft}
      onErfassen={async (w) => {
        if (schonGeschlossen) return;
        const meldung = stelle.belegung?.id ?? null;
        if (brauchtLeermeldung && w.leermeldung && geleertGegen.current !== meldung) {
          await onLeermeldung();
          geleertGegen.current = meldung;
        }
        await onErfassen({ status: 'geschlossen' });
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {schonGeschlossen ? (
        <Typography.Paragraph type="secondary">
          Die Stelle ist bereits geschlossen.
        </Typography.Paragraph>
      ) : brauchtLeermeldung ? (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={`Die Stelle ist mit ${personenZahl(belegt)} Personen belegt.`}
          />
          <Form.Item
            name="leermeldung"
            valuePropName="checked"
            style={{ marginBottom: 0 }}
            rules={[
              {
                validator: (_, v) =>
                  v
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(
                          'Eine belegte Stelle lässt sich erst nach einer Leermeldung schließen.',
                        ),
                      ),
              },
            ]}
          >
            <Checkbox>Alle haben die Stelle verlassen — Belegung 0 melden</Checkbox>
          </Form.Item>
        </>
      ) : (
        <Typography.Paragraph type="secondary">Die Stelle ist leer gemeldet.</Typography.Paragraph>
      )}
      <SpeicherFehler fehler={fehler} titel="Betreuungsstelle konnte nicht geschlossen werden" />
    </ErfassungsModal>
  );
}

export function BelegungMeldenDialog({
  stelle,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: DialogBasis & {
  stelle: Betreuungsstelle;
  onErfassen: (body: BelegungsmeldungEingabe) => Promise<unknown>;
}) {
  const [form] = Form.useForm<BelegungWerte>();
  const bisher = stelle.belegung ? personenZahl(stelle.belegung.belegt) : 'keine Meldung';
  const kapazitaet =
    stelle.kapazitaet_personen != null
      ? `, Kapazität ${personenZahl(stelle.kapazitaet_personen)}`
      : ', keine Kapazität festgelegt';
  return (
    <ErfassungsModal<BelegungWerte>
      offen
      titel={`Belegung melden: ${stelle.bezeichnung}`}
      form={form}
      erfassenText="Melden"
      laeuft={laeuft}
      onErfassen={(w) => onErfassen(belegungBody(w))}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Typography.Paragraph type="secondary">
        Bisher: {bisher}
        {kapazitaet}
      </Typography.Paragraph>
      {/* „gesamt“: gemeldet wird die Gesamtzahl, nicht der Zuwachs. */}
      {personenFeld('belegt', 'Belegt gesamt (Personen)', 0, true)}
      {weitere(zeitpunktFeld())}
      <SpeicherFehler fehler={fehler} titel="Belegung konnte nicht gemeldet werden" />
    </ErfassungsModal>
  );
}

// ── Stornieren ──────────────────────────────────────────────────────────────────────────

/**
 * Stornieren ist UNUMKEHRBAR (Fehlanlage): Rückfrage als eigenes `Modal` mit rotem Knopf, kein
 * `Popconfirm`. Der Aufrufer rendert EINEN Dialog außerhalb der Zeilen. `stattdessen` zeigt den
 * umkehrbaren Weg als Link-Knopf statt als Erklärsatz (LFH-1078).
 */
export function StornierenDialog({
  titel,
  text: beschreibung,
  stattdessen,
  laeuft,
  fehler,
  onBestaetigen,
  onSchliessen,
}: DialogBasis & {
  titel: string;
  text: string;
  stattdessen?: { text: string; onKlick: () => void };
  onBestaetigen: () => void;
}) {
  return (
    <Modal
      open
      title={titel}
      okText="Stornieren"
      cancelText="Abbrechen"
      okButtonProps={{ danger: true }}
      confirmLoading={laeuft}
      onOk={onBestaetigen}
      onCancel={onSchliessen}
      destroyOnHidden
    >
      <Typography.Paragraph>{beschreibung}</Typography.Paragraph>
      {stattdessen && (
        <Button
          type="link"
          disabled={laeuft}
          onClick={stattdessen.onKlick}
          style={{ paddingInline: 0 }}
        >
          {stattdessen.text}
        </Button>
      )}
      <SpeicherFehler fehler={fehler} titel="Stornieren fehlgeschlagen" />
    </Modal>
  );
}
