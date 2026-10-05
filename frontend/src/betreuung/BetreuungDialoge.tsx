import { Alert, Checkbox, Collapse, Form, Input, InputNumber, Modal, Radio } from 'antd';
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
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { betreuungsstelleStatus, raeumungszustand } from '../theme/statusFarben';
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

const ZEITFORMAT = 'YYYY-MM-DD HH:mm';

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

interface BezirkWerte {
  bezeichnung: string;
  plan_personen: number;
  plan_erhebung: Erhebung;
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

interface StelleWerte {
  bezeichnung: string;
  art: BetreuungsstelleArt;
  status?: BetreuungsstelleStatus;
  kapazitaet_personen?: number | null;
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
}

function stelleAnlegenBody(w: StelleWerte): BetreuungsstelleEingabe {
  return {
    bezeichnung: w.bezeichnung.trim(),
    art: w.art,
    ...(w.kapazitaet_personen != null ? { kapazitaet_personen: w.kapazitaet_personen } : {}),
    ...(w.abschnitt_id != null ? { abschnitt_id: w.abschnitt_id } : {}),
    ...optionaleTexte({ standort: w.standort, notiz: w.notiz }),
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

const ART_OPTIONEN = (Object.keys(ART_LABEL) as BetreuungsstelleArt[]).map((a) => ({
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

const hoechstensRegel = {
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
    <Form.Item
      name="zeitpunkt"
      label="Zeitpunkt"
      extra="Leer: jetzt. Eine nachgetragene ältere Meldung ändert den aktuellen Stand nicht."
      rules={[zeitRegel]}
      style={{ marginBottom: 0 }}
    >
      {/* Uhrzeit und Kalendertag in der Anzeigezone (LFH-692); `zeitRegel` prüft den Zeitpunkt. */}
      <ZeitpunktEingabe format={ZEITFORMAT} keineZukunftstage style={{ width: '100%' }} />
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

export function BezirkAnlegenDialog({
  abschnitte,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: DialogBasis & {
  abschnitte: readonly AbschnittOption[];
  onErfassen: (body: EvakuierungsbezirkEingabe) => Promise<unknown>;
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
      // nie still.
      initialValues={{ plan_erhebung: 'geschaetzt' }}
      onErfassen={(w) => onErfassen(bezirkAnlegenBody(w))}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        name="bezeichnung"
        label="Bezeichnung"
        extra="Straßenzug oder Bezirksnummer — keine Namen von Bewohnern. Die Bezeichnung steht im Einsatztagebuch."
        rules={[{ required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' }]}
      >
        <Input />
      </Form.Item>
      {personenFeld('plan_personen', 'Plangröße (Personen)', 1, true)}
      {erhebungFeld('plan_erhebung', 'Erhebung')}
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

export function BezirkBearbeitenDialog({
  bezirk,
  abschnitte,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: DialogBasis & {
  /** Der AKTUELLE Stand aus dem Cache — nicht der beim Öffnen. */
  bezirk: Evakuierungsbezirk;
  abschnitte: readonly AbschnittOption[];
  onErfassen: (patch: EvakuierungsbezirkPatch) => Promise<unknown>;
}) {
  const [form] = Form.useForm<BezirkWerte>();
  const [beimOeffnen] = useState(bezirk);
  return (
    <ErfassungsModal<BezirkWerte>
      offen
      titel={`Bezirk bearbeiten: ${bezirk.bezeichnung}`}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      initialValues={{
        bezeichnung: beimOeffnen.bezeichnung,
        plan_personen: beimOeffnen.plan_personen,
        plan_erhebung: beimOeffnen.plan_erhebung,
        abschnitt_id: beimOeffnen.abschnitt_id ?? undefined,
        sammelstelle: beimOeffnen.sammelstelle ?? undefined,
        notiz: beimOeffnen.notiz ?? undefined,
      }}
      onErfassen={(w) =>
        nurWennGeaendert(bezirkPatchDreiseitig(beimOeffnen, bezirk, w), onErfassen)
      }
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {personenFeld('plan_personen', 'Plangröße (Personen)', 1, true)}
      {erhebungFeld('plan_erhebung', 'Erhebung')}
      {weitere(
        <>
          <Form.Item
            name="bezeichnung"
            label="Bezeichnung"
            rules={[
              { required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' },
            ]}
          >
            <Input />
          </Form.Item>
          {abschnittFeld(abschnitte)}
          <Form.Item name="sammelstelle" label="Sammelstelle">
            <Input />
          </Form.Item>
          <Form.Item name="notiz" label="Notiz" style={{ marginBottom: 0 }}>
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
        </>,
      )}
      <SpeicherFehler fehler={fehler} titel="Bezirk konnte nicht gespeichert werden" />
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
      <Form.Item
        name="raeumung"
        label="Räumungszustand"
        extra="„aufgehoben“ nimmt den Bezirk aus der Kennzahl „Evakuiert“."
        rules={[{ required: true }]}
      >
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
      <Typography.Paragraph type="secondary">
        Bisher: {evakuiertText(bezirk)}. Gemeldet wird die Gesamtzahl, nicht der Zuwachs.
      </Typography.Paragraph>
      {personenFeld('evakuiert', 'Evakuiert (Personen)', 0, true)}
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
      <Form.Item
        name="kapazitaet_personen"
        label="Kapazität (Personen)"
        extra="Leer: keine Kapazität — dann wird keine Zahl freier Plätze ausgewiesen."
        rules={[hoechstensRegel]}
      >
        <InputNumber min={1} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      {weitere(
        <>
          {abschnittFeld(abschnitte)}
          <Form.Item name="standort" label="Standort">
            <Input />
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

interface StelleBearbeitenWerte extends StelleWerte {
  leermeldung?: boolean;
}

const STATUS_FOLGE: readonly BetreuungsstelleStatus[] = [
  'vorbereitet',
  'in_betrieb',
  'geschlossen',
];

/**
 * Stelle bearbeiten — Status, Kapazität, Art sichtbar, der Rest eingeklappt.
 *
 * Schließen einer BELEGTEN Stelle: der Server verlangt Belegung 0. Der Dialog bietet die
 * Leermeldung als ausdrückliches Häkchen an, nicht als stille Vorgabe — eine ungemeldete „0"
 * wäre eine erfundene Zahl. Erst die Meldung, dann der Status.
 *
 * Scheitert der zweite Aufruf, darf ein neuer Versuch die 0 nicht noch einmal melden (doppelt
 * im ETB). Der Merker hält deshalb die Belegungsmeldung fest, gegen die geleert wurde: meldet
 * danach jemand anderes wieder Personen, gilt der Haken neu.
 */
export function StelleBearbeitenDialog({
  stelle,
  abschnitte,
  laeuft,
  fehler,
  onErfassen,
  onLeermeldung,
  onSchliessen,
}: DialogBasis & {
  /** Der AKTUELLE Stand aus dem Cache — nicht der beim Öffnen. */
  stelle: Betreuungsstelle;
  abschnitte: readonly AbschnittOption[];
  onErfassen: (patch: BetreuungsstellePatch) => Promise<unknown>;
  /** Meldet Belegung 0 (ohne Zeitpunkt = jetzt). */
  onLeermeldung: () => Promise<unknown>;
}) {
  const [form] = Form.useForm<StelleBearbeitenWerte>();
  const [beimOeffnen] = useState(stelle);
  const geleertGegen = useRef<number | null>(null);
  const status = Form.useWatch('status', form);
  const belegt = stelle.belegung?.belegt ?? 0;
  // Nötig genau dann, wenn der PATCH das Schließen trägt (dreiseitig) und die Stelle JETZT belegt
  // ist. Ein unberührtes „geschlossen" einer fremd wiedereröffneten Stelle sperrt nichts.
  const brauchtLeermeldung =
    status === 'geschlossen' &&
    beimOeffnen.status !== 'geschlossen' &&
    stelle.status !== 'geschlossen' &&
    belegt > 0;

  return (
    <ErfassungsModal<StelleBearbeitenWerte>
      offen
      titel={`Stelle bearbeiten: ${stelle.bezeichnung}`}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      initialValues={{
        status: beimOeffnen.status,
        kapazitaet_personen: beimOeffnen.kapazitaet_personen ?? undefined,
        art: beimOeffnen.art,
        bezeichnung: beimOeffnen.bezeichnung,
        abschnitt_id: beimOeffnen.abschnitt_id ?? undefined,
        standort: beimOeffnen.standort ?? undefined,
        notiz: beimOeffnen.notiz ?? undefined,
      }}
      onErfassen={async (w) => {
        const patch = stellePatchDreiseitig(beimOeffnen, stelle, w);
        if (Object.keys(patch).length === 0) return;
        const meldung = stelle.belegung?.id ?? null;
        if (brauchtLeermeldung && w.leermeldung && geleertGegen.current !== meldung) {
          await onLeermeldung();
          geleertGegen.current = meldung;
        }
        await onErfassen(patch);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item name="status" label="Status" rules={[{ required: true }]}>
        <Radio.Group
          name="status"
          optionType="button"
          options={STATUS_FOLGE.map((s) => ({ value: s, label: betreuungsstelleStatus[s].label }))}
        />
      </Form.Item>
      {brauchtLeermeldung && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={`Die Stelle ist mit ${personenZahl(belegt)} Personen belegt.`}
            description="Geschlossen werden kann sie erst, wenn alle sie verlassen haben. Das wird als Belegung 0 gemeldet und steht im Einsatztagebuch."
          />
          <Form.Item
            name="leermeldung"
            valuePropName="checked"
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
      )}
      <Form.Item
        name="kapazitaet_personen"
        label="Kapazität (Personen)"
        extra="Leer: keine Kapazität — dann wird keine Zahl freier Plätze ausgewiesen."
        rules={[hoechstensRegel]}
      >
        <InputNumber min={1} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="art" label="Art" rules={[{ required: true }]}>
        <Select options={ART_OPTIONEN} />
      </Form.Item>
      {weitere(
        <>
          <Form.Item
            name="bezeichnung"
            label="Bezeichnung"
            rules={[
              { required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' },
            ]}
          >
            <Input />
          </Form.Item>
          {abschnittFeld(abschnitte)}
          <Form.Item name="standort" label="Standort">
            <Input />
          </Form.Item>
          <Form.Item name="notiz" label="Notiz" style={{ marginBottom: 0 }}>
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
        </>,
      )}
      <SpeicherFehler fehler={fehler} titel="Betreuungsstelle konnte nicht gespeichert werden" />
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
        {kapazitaet}. Gemeldet wird die Gesamtzahl, nicht der Zuwachs.
      </Typography.Paragraph>
      {personenFeld('belegt', 'Belegt (Personen)', 0, true)}
      {weitere(zeitpunktFeld())}
      <SpeicherFehler fehler={fehler} titel="Belegung konnte nicht gemeldet werden" />
    </ErfassungsModal>
  );
}

// ── Stornieren ──────────────────────────────────────────────────────────────────────────

/**
 * Stornieren ist UNUMKEHRBAR (Fehlanlage): Rückfrage als eigenes `Modal` mit rotem Knopf, kein
 * `Popconfirm`. Der Aufrufer rendert EINEN Dialog außerhalb der Zeilen.
 */
export function StornierenDialog({
  titel,
  text: beschreibung,
  laeuft,
  fehler,
  onBestaetigen,
  onSchliessen,
}: DialogBasis & {
  titel: string;
  text: string;
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
      <SpeicherFehler fehler={fehler} titel="Stornieren fehlgeschlagen" />
    </Modal>
  );
}
