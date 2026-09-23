import {
  Alert,
  Checkbox,
  Collapse,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
} from 'antd';
import { Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useRef, type ReactNode } from 'react';
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
import { alsBackendZeit } from '../etb/filterZeit';
import { betreuungsstelleStatus, raeumungszustand } from '../theme/statusFarben';
import {
  ART_LABEL,
  ERHEBUNG_LABEL,
  RAEUMUNG_FOLGE,
  evakuiertText,
  personenZahl,
} from './betreuungText';

/**
 * Die Erfassungsmasken des Fachmoduls Betreuung (LFH-639), alle auf `ErfassungsModal`
 * (Erfassungs-Norm LFH-332): Absende-Knopf im `<form>`, Fokus im ersten Feld, Zurücksetzen auf
 * jedem Weg hinaus, `onErfassen` lehnt bei Ablehnung ab und die Felder bleiben stehen.
 *
 * FELDBUDGET (LFH-19): höchstens drei Felder sichtbar, der Rest unter „Weitere Angaben" in
 * einem `Collapse` mit `forceRender` — nur so kommen die eingeklappten Werte in `onFinish` an.
 * Bearbeitet wird alles, was der PATCH annimmt; eingeklappt heißt nicht unerreichbar.
 *
 * ZEIT (design.md D2): ein Zeitpunkt geht über `alsBackendZeit` hinaus. Ein LEERES Feld heißt
 * „jetzt" und lässt den Schlüssel weg — der Server setzt die Zeit. `alsBackendZeit(dayjs())`
 * zu schicken hieße, die Client-Uhr zu vertrauen: geht sie über 60 s vor, antwortet der Server
 * für „jetzt" mit 400.
 *
 * PATCH (D5, Leerlauf-Riegel): die Masken schicken nur geänderte Schlüssel. `null` bedeutet
 * „leeren" und entsteht nur, wo vorher ein Wert stand — ein `null` auf ein leeres Feld wäre
 * dieselbe Aussage in einer Form, die der Leser nicht von einer Änderung unterscheiden kann.
 */

const ZEITFORMAT = 'YYYY-MM-DD HH:mm';

export interface AbschnittOption {
  value: number;
  label: string;
}

// ── Reine Abbildungen: hier wohnt die Drift, deshalb exportiert und direkt getestet ─────────

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

export interface StandWerte {
  evakuiert: number;
  erhebung: Erhebung;
  zeitpunkt?: Dayjs | null;
}

export function standBody(w: StandWerte): StandmeldungEingabe {
  return { evakuiert: w.evakuiert, erhebung: w.erhebung, ...zeitpunkt(w.zeitpunkt) };
}

export interface BelegungWerte {
  belegt: number;
  zeitpunkt?: Dayjs | null;
}

export function belegungBody(w: BelegungWerte): BelegungsmeldungEingabe {
  return { belegt: w.belegt, ...zeitpunkt(w.zeitpunkt) };
}

export interface BezirkWerte {
  bezeichnung: string;
  plan_personen: number;
  plan_erhebung: Erhebung;
  abschnitt_id?: number | null;
  sammelstelle?: string | null;
  notiz?: string | null;
}

export function bezirkAnlegenBody(w: BezirkWerte): EvakuierungsbezirkEingabe {
  return {
    bezeichnung: w.bezeichnung.trim(),
    plan_personen: w.plan_personen,
    plan_erhebung: w.plan_erhebung,
    ...(w.abschnitt_id != null ? { abschnitt_id: w.abschnitt_id } : {}),
    ...optionaleTexte({ sammelstelle: w.sammelstelle, notiz: w.notiz }),
  };
}

/**
 * Setzt `patch[k]`, wenn sich der Wert gegenüber `alt` ändert. `undefined` wird dabei zu `null`:
 * ein geleertes Auswahlfeld (`allowClear`) liefert `undefined`, und das fiele beim
 * Serialisieren still weg — der Abschnitt bliebe gesetzt, obwohl die Person ihn gelöst hat.
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
}

export function stelleAnlegenBody(w: StelleWerte): BetreuungsstelleEingabe {
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

/** Kein Zeitpunkt in der Zukunft — der Server duldet 60 s Uhrenversatz, mehr ist 400. */
const zeitRegel = {
  validator: (_: unknown, v: Dayjs | null | undefined) =>
    v && v.isAfter(dayjs().add(1, 'minute'))
      ? Promise.reject(new Error('Der Zeitpunkt liegt in der Zukunft.'))
      : Promise.resolve(),
};

function erhebungFeld(name: string, label: string) {
  return (
    <Form.Item name={name} label={label} rules={[{ required: true }]}>
      {/* `name` ausdrücklich: zwei Radio-Gruppen ohne Namen gruppierte der Browser nativ zu
          EINER (Memory `antd-radiogroup-name-kollision`). */}
      <Radio.Group name={name} optionType="button" options={ERHEBUNG_OPTIONEN} />
    </Form.Item>
  );
}

function personenFeld(name: string, label: string, min: number, pflicht: boolean) {
  return (
    <Form.Item
      name={name}
      label={label}
      rules={pflicht ? [{ required: true, message: 'Bitte eine Anzahl angeben' }] : []}
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
      <DatePicker
        showTime
        format={ZEITFORMAT}
        disabledDate={(d) => d.isAfter(dayjs(), 'day')}
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
      // Eine Plangröße steht zu Beginn fast immer auf Melderegister oder Schätzung; wer
      // gezählt hat, wählt um. Die Erhebung ist sichtbar, der Vorgabewert also nie still.
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
  bezirk: Evakuierungsbezirk;
  abschnitte: readonly AbschnittOption[];
  onErfassen: (patch: EvakuierungsbezirkPatch) => Promise<unknown>;
}) {
  const [form] = Form.useForm<BezirkWerte>();
  return (
    <ErfassungsModal<BezirkWerte>
      offen
      titel={`Bezirk bearbeiten: ${bezirk.bezeichnung}`}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      initialValues={{
        bezeichnung: bezirk.bezeichnung,
        plan_personen: bezirk.plan_personen,
        plan_erhebung: bezirk.plan_erhebung,
        abschnitt_id: bezirk.abschnitt_id ?? undefined,
        sammelstelle: bezirk.sammelstelle ?? undefined,
        notiz: bezirk.notiz ?? undefined,
      }}
      onErfassen={(w) => nurWennGeaendert(bezirkPatch(bezirk, w), onErfassen)}
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

/** Räumungszustand setzen. Umkehrbar (jeder Zustand ist wieder wählbar) — keine Rückfrage. */
export function RaeumungDialog({
  bezirk,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: DialogBasis & {
  bezirk: Evakuierungsbezirk;
  onErfassen: (patch: EvakuierungsbezirkPatch) => Promise<unknown>;
}) {
  const [form] = Form.useForm<RaeumungWerte>();
  return (
    <ErfassungsModal<RaeumungWerte>
      offen
      titel={`Räumung: ${bezirk.bezeichnung}`}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      initialValues={{ raeumung: bezirk.raeumung }}
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
 * SCHLIESSEN EINER BELEGTEN STELLE (design.md D4): der Server verlangt Belegung 0, statt sie
 * zu erfinden. Der Dialog bietet deshalb die Leermeldung an — als ausdrückliches Häkchen,
 * nicht als stille Vorgabe: eine „0", die niemand gemeldet hat, wäre genau die erfundene
 * Zahl, die D4 verbietet. Erst die Meldung, dann der Status; zwei Aufrufe, zwei Tatsachen.
 *
 * Scheitert der zweite Aufruf, darf ein neuer Versuch die 0 NICHT noch einmal melden — sonst
 * stünde sie doppelt im Einsatztagebuch. Der Merker lebt so lange wie der Dialog.
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
  stelle: Betreuungsstelle;
  abschnitte: readonly AbschnittOption[];
  onErfassen: (patch: BetreuungsstellePatch) => Promise<unknown>;
  /** Meldet Belegung 0 (ohne Zeitpunkt = jetzt). */
  onLeermeldung: () => Promise<unknown>;
}) {
  const [form] = Form.useForm<StelleBearbeitenWerte>();
  const leerGemeldet = useRef(false);
  const status = Form.useWatch('status', form);
  const belegt = stelle.belegung?.belegt ?? 0;
  const brauchtLeermeldung =
    status === 'geschlossen' && stelle.status !== 'geschlossen' && belegt > 0;

  return (
    <ErfassungsModal<StelleBearbeitenWerte>
      offen
      titel={`Stelle bearbeiten: ${stelle.bezeichnung}`}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      initialValues={{
        status: stelle.status,
        kapazitaet_personen: stelle.kapazitaet_personen ?? undefined,
        art: stelle.art,
        bezeichnung: stelle.bezeichnung,
        abschnitt_id: stelle.abschnitt_id ?? undefined,
        standort: stelle.standort ?? undefined,
        notiz: stelle.notiz ?? undefined,
      }}
      onErfassen={async (w) => {
        const patch = stellePatch(stelle, w);
        if (Object.keys(patch).length === 0) return;
        if (brauchtLeermeldung && w.leermeldung && !leerGemeldet.current) {
          await onLeermeldung();
          leerGemeldet.current = true;
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
 * Stornieren ist UNUMKEHRBAR (Fehlanlage) und bekommt deshalb eine Rückfrage — als eigenes
 * `Modal` mit rotem Bestätigungsknopf (Bauform LFH-365: kein `Popconfirm` im Menü). Der
 * Aufrufer rendert EINEN Dialog außerhalb der Zeilen, nicht je Zeile einen.
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
