import { Collapse, DatePicker, Form, Input, InputNumber, Modal, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useEffect, useRef, type ReactNode } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type {
  AusgabeEingabe,
  BenutzerAnzeige,
  Kostform,
  ModulOverrides,
  SonderkostEingabe,
  VerpflegungAusgabe,
  VerpflegungZeitfenster,
  ZeitfensterEingabe,
  ZeitfensterPatch,
} from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { alsBackendZeit, alsOrtszeit } from '../etb/filterZeit';
import { useBedarfsvorschlag, type Vorschlag } from './useBedarfsvorschlag';
import { KOSTFORM_LABEL, KOSTFORMEN, sonderkostText, uhrzeit, zitat } from './verpflegungText';

dayjs.extend(utc);

/**
 * Die Erfassungsmasken des Fachmoduls Verpflegung (LFH-634, design.md D7), beide auf
 * `ErfassungsModal` (Erfassungs-Norm LFH-332): Absende-Knopf im `<form>`, Fokus im ersten
 * Feld, Zurücksetzen auf jedem Weg hinaus, `onErfassen` lehnt bei Ablehnung ab und die Felder
 * bleiben stehen. Server-Gründe (400/422) stehen IM Dialog (`SpeicherFehler`).
 *
 * FELDBUDGET (LFH-19): „Zeitfenster" zeigt VIER Felder — eins über dem Richtwert, bewusst
 * (D7): die beiden Bedarfsteile tragen je einen Vorschlag mit Herkunft, und eingeklappt wären
 * genau diese Vorschläge unsichtbar. „Ausgabe" zeigt drei. Der Rest liegt in einem `Collapse`
 * mit `forceRender` — nur so kommen die eingeklappten Werte in `onFinish` an.
 *
 * ZEIT (D2): Wire-Zeiten sind UTC ohne Zone. Hinaus über `alsBackendZeit`, herein über
 * `alsOrtszeit` — nie `dayjs(s)`, das verschöbe still um den Zonenversatz. Ein LEERER
 * Ausgabezeitpunkt lässt den Schlüssel weg: „jetzt" setzt der Server, nicht die Client-Uhr.
 *
 * PATCH (D4): zweiwertig — Schlüssel fehlt = unverändert, es gibt kein `null`. Gesendet werden
 * nur geänderte Schlüssel; ein geleertes optionales Zahlfeld (weitere Personen, eine Kostform)
 * heißt 0. Ein leerer PATCH wird nicht gesendet, der Dialog schließt, als wäre gespeichert.
 */

const ZEITFORMAT = 'YYYY-MM-DD HH:mm';

type SonderkostWerte = Partial<Record<Kostform, number | null>>;

/** Getrimmter Text oder `null` — ein Feld aus Leerzeichen ist leer. */
function text(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/** Nur Kostformen mit Anzahl > 0 in einen Anlage-Body; `undefined`, wenn keine. */
function sonderkostAnlegen(sk: SonderkostWerte | undefined): SonderkostEingabe | undefined {
  const aus: SonderkostEingabe = {};
  for (const k of KOSTFORMEN) {
    const n = sk?.[k];
    if (n != null && n > 0) aus[k] = n;
  }
  return Object.keys(aus).length > 0 ? aus : undefined;
}

// ── Zeitfenster: reine Abbildungen ──────────────────────────────────────────────────────

export interface ZeitfensterWerte {
  bezeichnung: string;
  zeitraum: [Dayjs, Dayjs];
  bedarf_kraefte: number;
  bedarf_betreute: number;
  bedarf_weitere?: number | null;
  sonderkost?: SonderkostWerte;
}

export function zeitfensterAnlegenBody(w: ZeitfensterWerte): ZeitfensterEingabe {
  const sonderkost = sonderkostAnlegen(w.sonderkost);
  return {
    bezeichnung: w.bezeichnung.trim(),
    von_at: alsBackendZeit(w.zeitraum[0]),
    bis_at: alsBackendZeit(w.zeitraum[1]),
    bedarf_kraefte: w.bedarf_kraefte,
    bedarf_betreute: w.bedarf_betreute,
    ...(w.bedarf_weitere != null ? { bedarf_weitere: w.bedarf_weitere } : {}),
    ...(sonderkost ? { sonderkost } : {}),
  };
}

/** Wire-Zeit normalisiert — ein Vergleich roher Strings sähe „…:00" und „…:00.000" verschieden. */
function normalisiert(wire: string): string {
  return alsBackendZeit(dayjs.utc(wire));
}

export function zeitfensterPatch(
  vorher: VerpflegungZeitfenster,
  w: ZeitfensterWerte,
): ZeitfensterPatch {
  const patch: ZeitfensterPatch = {};
  const bezeichnung = text(w.bezeichnung);
  if (bezeichnung != null && bezeichnung !== vorher.bezeichnung) patch.bezeichnung = bezeichnung;
  const von = alsBackendZeit(w.zeitraum[0]);
  const bis = alsBackendZeit(w.zeitraum[1]);
  if (von !== normalisiert(vorher.von_at)) patch.von_at = von;
  if (bis !== normalisiert(vorher.bis_at)) patch.bis_at = bis;
  if (w.bedarf_kraefte !== vorher.bedarf.kraefte) patch.bedarf_kraefte = w.bedarf_kraefte;
  if (w.bedarf_betreute !== vorher.bedarf.betreute) patch.bedarf_betreute = w.bedarf_betreute;
  const weitere = w.bedarf_weitere ?? 0;
  if (weitere !== vorher.bedarf.weitere) patch.bedarf_weitere = weitere;
  const sk: SonderkostEingabe = {};
  for (const k of KOSTFORMEN) {
    const neu = w.sonderkost?.[k] ?? 0;
    if (neu !== vorher.bedarf.sonderkost[k]) sk[k] = neu;
  }
  if (Object.keys(sk).length > 0) patch.sonderkost = sk;
  return patch;
}

// ── Ausgabe: reine Abbildung ────────────────────────────────────────────────────────────

export interface AusgabeWerte {
  menge: number;
  ort?: string | null;
  zeitpunkt?: Dayjs | null;
  sonderkost?: SonderkostWerte;
  nachforderung_id?: number | null;
  bemerkung?: string | null;
}

export function ausgabeBody(w: AusgabeWerte): AusgabeEingabe {
  const ort = text(w.ort);
  const bemerkung = text(w.bemerkung);
  const sonderkost = sonderkostAnlegen(w.sonderkost);
  return {
    menge: w.menge,
    ...(w.zeitpunkt ? { zeitpunkt_at: alsBackendZeit(w.zeitpunkt) } : {}),
    ...(ort != null ? { ort } : {}),
    ...(sonderkost ? { sonderkost } : {}),
    ...(w.nachforderung_id != null ? { nachforderung_id: w.nachforderung_id } : {}),
    ...(bemerkung != null ? { bemerkung } : {}),
  };
}

// ── Bausteine ───────────────────────────────────────────────────────────────────────────

function anzahlFeld(min = 0) {
  return <InputNumber min={min} precision={0} style={{ width: '100%' }} />;
}

/** Eingeklappter Bereich — `forceRender` ist TRAGEND (sonst fehlen die Werte in `onFinish`). */
function eingeklappt(label: string, children: ReactNode) {
  return <Collapse ghost items={[{ key: 'weitere', label, forceRender: true, children }]} />;
}

function sonderkostFelder(hinweis: string) {
  return (
    <>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {hinweis}
      </Typography.Paragraph>
      {KOSTFORMEN.map((k) => (
        <Form.Item key={k} name={['sonderkost', k]} label={KOSTFORM_LABEL[k]}>
          {anzahlFeld()}
        </Form.Item>
      ))}
    </>
  );
}

interface DialogBasis {
  laeuft: boolean;
  /** `mutation.error` — steht IM Dialog, bis zum nächsten Absenden. */
  fehler: unknown;
  onSchliessen: () => void;
}

// ── Zeitfenster anlegen / bearbeiten ────────────────────────────────────────────────────

/**
 * Feldhilfe eines Bedarfsfelds. Beim ANLEGEN steht der Vorschlag im Feld, die Hilfe nennt nur
 * die Herkunft. Beim BEARBEITEN überschreibt der Vorschlag nichts — die Hilfe nennt deshalb
 * die Zahl mit (Risiko „gespeicherter Bedarf veraltet", D8).
 */
export function vorschlagHilfe(v: Vorschlag, anlegen: boolean): string | undefined {
  if (v.hinweis == null) return undefined;
  if (anlegen || v.wert == null) return v.hinweis;
  return `Aktuell ${v.wert} — ${v.hinweis}`;
}

export type ZeitfensterModus =
  | { art: 'anlegen'; onErfassen: (body: ZeitfensterEingabe) => Promise<unknown> }
  | {
      art: 'bearbeiten';
      zeitfenster: VerpflegungZeitfenster;
      onErfassen: (patch: ZeitfensterPatch) => Promise<unknown>;
    };

interface ZeitfensterDialogProps extends DialogBasis {
  modus: ZeitfensterModus;
  einsatzId: number;
  benutzer: BenutzerAnzeige | null;
  /** `overridesQuery.data` unverändert — `undefined` heißt „noch unbekannt" (Hook-Vertrag). */
  overrides: ModulOverrides | undefined;
  jetzt: Dayjs;
}

type Bedarfsfeld = 'bedarf_kraefte' | 'bedarf_betreute';

export function ZeitfensterDialog({
  modus,
  einsatzId,
  benutzer,
  overrides,
  jetzt,
  laeuft,
  fehler,
  onSchliessen,
}: ZeitfensterDialogProps) {
  const [form] = Form.useForm<ZeitfensterWerte>();
  const anlegen = modus.art === 'anlegen';
  const vorher = modus.art === 'bearbeiten' ? modus.zeitfenster : null;

  // Der Beginn geht als Wire-String in den Query-Key der Kopfzahl: stabil, solange die Person
  // den Zeitraum nicht ändert — nie ein je Render neu gerechnetes „jetzt".
  const zeitraum = Form.useWatch('zeitraum', form) as [Dayjs | null, Dayjs | null] | undefined;
  const beginn = zeitraum?.[0];
  // Im ersten Render ist `useWatch` noch leer — beim Bearbeiten gilt bis dahin der gespeicherte
  // Beginn, sonst ginge eine Kopfzahl-Anfrage „jetzt" hinaus und der Hinweis spränge kurz um.
  const vonAt =
    beginn && beginn.isValid()
      ? alsBackendZeit(beginn)
      : zeitraum === undefined && vorher
        ? normalisiert(vorher.von_at)
        : undefined;
  const vorschlag = useBedarfsvorschlag({ einsatzId, vonAt, benutzer, overrides, jetzt });

  // Eigener Merker „hat die Person das Feld angefasst?" statt `isFieldTouched`: auch eine
  // Vorbelegung per `setFieldValue` wäre sonst von der Hand der Person nicht zu trennen, und
  // ein Vorschlag, der nach einem geänderten Beginn nachzieht, überschriebe ihre Zahl (D8).
  const beruehrt = useRef<Record<Bedarfsfeld, boolean>>({
    bedarf_kraefte: false,
    bedarf_betreute: false,
  });
  const { wert: kraefteWert, hinweis: kraefteHinweis } = vorschlag.kraefte;
  const { wert: betreuteWert, hinweis: betreuteHinweis } = vorschlag.betreute;
  // Nur beim ANLEGEN, und nur wenn die Quelle geantwortet hat (`hinweis`): während sie lädt,
  // ist `wert` ebenfalls `null`, und ein Leeren dabei ließe die Zahl flackern.
  useEffect(() => {
    if (!anlegen || kraefteHinweis == null || beruehrt.current.bedarf_kraefte) return;
    form.setFieldValue('bedarf_kraefte', kraefteWert ?? undefined);
  }, [anlegen, form, kraefteWert, kraefteHinweis]);
  useEffect(() => {
    if (!anlegen || betreuteHinweis == null || beruehrt.current.bedarf_betreute) return;
    form.setFieldValue('bedarf_betreute', betreuteWert ?? undefined);
  }, [anlegen, form, betreuteWert, betreuteHinweis]);

  const merke = (feld: Bedarfsfeld) => () => {
    beruehrt.current[feld] = true;
  };

  const initialValues: Partial<ZeitfensterWerte> | undefined = vorher
    ? {
        bezeichnung: vorher.bezeichnung,
        zeitraum: [alsOrtszeit(vorher.von_at)!, alsOrtszeit(vorher.bis_at)!],
        bedarf_kraefte: vorher.bedarf.kraefte,
        bedarf_betreute: vorher.bedarf.betreute,
        bedarf_weitere: vorher.bedarf.weitere,
        sonderkost: { ...vorher.bedarf.sonderkost },
      }
    : undefined;

  return (
    <ErfassungsModal<ZeitfensterWerte>
      offen
      titel={vorher ? `Bedarf bearbeiten: ${vorher.bezeichnung}` : 'Zeitfenster anlegen'}
      form={form}
      erfassenText={anlegen ? 'Anlegen' : 'Speichern'}
      laeuft={laeuft}
      initialValues={initialValues}
      onErfassen={(w) => {
        if (modus.art === 'anlegen') return modus.onErfassen(zeitfensterAnlegenBody(w));
        const patch = zeitfensterPatch(modus.zeitfenster, w);
        return Object.keys(patch).length === 0 ? Promise.resolve() : modus.onErfassen(patch);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<ZeitfensterWerte>
        name="bezeichnung"
        label="Bezeichnung"
        extra="Mahlzeit, z. B. „Mittag“ — sie steht im Einsatztagebuch."
        rules={[{ required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' }]}
      >
        <Input />
      </Form.Item>
      <Form.Item<ZeitfensterWerte>
        name="zeitraum"
        label="Zeitraum"
        rules={[{ required: true, message: 'Bitte Beginn und Ende angeben' }]}
      >
        <DatePicker.RangePicker
          showTime
          format={ZEITFORMAT}
          placeholder={['Beginn', 'Ende']}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item<ZeitfensterWerte>
        name="bedarf_kraefte"
        label="Einsatzkräfte (EP)"
        extra={vorschlagHilfe(vorschlag.kraefte, anlegen)}
        rules={[{ required: true, message: 'Bitte eine Anzahl angeben — 0, wenn niemand' }]}
      >
        <InputNumber
          min={0}
          precision={0}
          style={{ width: '100%' }}
          onChange={merke('bedarf_kraefte')}
        />
      </Form.Item>
      <Form.Item<ZeitfensterWerte>
        name="bedarf_betreute"
        label="Betreute (EP)"
        extra={vorschlagHilfe(vorschlag.betreute, anlegen)}
        rules={[{ required: true, message: 'Bitte eine Anzahl angeben — 0, wenn niemand' }]}
      >
        <InputNumber
          min={0}
          precision={0}
          style={{ width: '100%' }}
          onChange={merke('bedarf_betreute')}
        />
      </Form.Item>
      {eingeklappt(
        'Weitere Personen und Sonderkost',
        <>
          <Form.Item<ZeitfensterWerte> name="bedarf_weitere" label="Weitere Personen (EP)">
            {anzahlFeld()}
          </Form.Item>
          {sonderkostFelder(
            'Sonderkost ist ein Teil der Essensportionen, kein Zuschlag. Ohne Personenbezug.',
          )}
        </>,
      )}
      <SpeicherFehler
        fehler={fehler}
        titel={anlegen ? 'Zeitfenster konnte nicht angelegt werden' : 'Bedarf nicht gespeichert'}
      />
    </ErfassungsModal>
  );
}

// ── Ausgabe erfassen ────────────────────────────────────────────────────────────────────

export interface NachforderungOption {
  value: number;
  label: string;
}

interface AusgabeDialogProps extends DialogBasis {
  zeitfenster: VerpflegungZeitfenster;
  /**
   * Nachforderungen zur Auswahl. `null` = das Modul Nachforderungen ist für die Person nicht
   * bedienbar — dann gibt es das Feld nicht (D4: keine Angaben eines fremden Moduls).
   */
  nachforderungen: readonly NachforderungOption[] | null;
  onErfassen: (body: AusgabeEingabe) => Promise<unknown>;
}

export function AusgabeDialog({
  zeitfenster: zf,
  nachforderungen,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: AusgabeDialogProps) {
  const [form] = Form.useForm<AusgabeWerte>();
  return (
    <ErfassungsModal<AusgabeWerte>
      offen
      titel={`Ausgabe erfassen: ${zf.bezeichnung}`}
      form={form}
      erfassenText="Erfassen"
      laeuft={laeuft}
      onErfassen={(w) => onErfassen(ausgabeBody(w))}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {/* Normaltext, nicht `secondary`: die Zeile ist im Dialog die einzige Angabe der Fehlmenge
          und damit tragend — als Tertiärtext hielt sie nachts nur 4,81 : 1 (Kontrast-Spec). */}
      <Typography.Paragraph style={{ fontVariantNumeric: 'tabular-nums' }}>
        Bedarf {zf.bedarf.gesamt} · ausgegeben {zf.ausgegeben.gesamt} · fehlt {zf.fehlmenge.gesamt}{' '}
        EP
      </Typography.Paragraph>
      <Form.Item<AusgabeWerte>
        name="menge"
        label="Menge (EP)"
        rules={[{ required: true, message: 'Bitte eine Menge angeben' }]}
      >
        {anzahlFeld(1)}
      </Form.Item>
      <Form.Item<AusgabeWerte> name="ort" label="Ort">
        <Input />
      </Form.Item>
      <Form.Item<AusgabeWerte> name="zeitpunkt" label="Zeitpunkt" extra="Leer: jetzt">
        <DatePicker showTime format={ZEITFORMAT} placeholder="jetzt" style={{ width: '100%' }} />
      </Form.Item>
      {eingeklappt(
        'Weitere Angaben',
        <>
          {sonderkostFelder('Sonderkost ist ein Teil der Menge, kein Zuschlag.')}
          {nachforderungen != null && (
            <Form.Item<AusgabeWerte>
              name="nachforderung_id"
              label="Nachforderung"
              extra="Die Ausgabe ändert den Status der Nachforderung nicht."
            >
              <Select
                allowClear
                placeholder="ohne Nachforderung"
                options={[...nachforderungen]}
                notFoundContent="Keine Nachforderungen im Einsatz"
              />
            </Form.Item>
          )}
          <Form.Item<AusgabeWerte> name="bemerkung" label="Bemerkung" style={{ marginBottom: 0 }}>
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
        </>,
      )}
      <SpeicherFehler fehler={fehler} titel="Ausgabe konnte nicht erfasst werden" />
    </ErfassungsModal>
  );
}

// ── Rückfragen ──────────────────────────────────────────────────────────────────────────

/**
 * Rückfrage vor einer unumkehrbaren Aktion (LFH-363): eigenes `Modal` mit rotem
 * Bestätigungsknopf, kein `Popconfirm` (LFH-365). Der Aufrufer rendert EINEN Dialog außerhalb
 * der Karten, nicht je Zeile einen.
 */
function Rueckfrage({
  titel,
  okText,
  children,
  laeuft,
  fehler,
  fehlerTitel,
  onBestaetigen,
  onSchliessen,
}: DialogBasis & {
  titel: string;
  okText: string;
  children: ReactNode;
  fehlerTitel: string;
  onBestaetigen: () => void;
}) {
  return (
    <Modal
      open
      title={titel}
      okText={okText}
      cancelText="Abbrechen"
      okButtonProps={{ danger: true }}
      confirmLoading={laeuft}
      onOk={onBestaetigen}
      onCancel={onSchliessen}
      destroyOnHidden
    >
      {children}
      <SpeicherFehler fehler={fehler} titel={fehlerTitel} />
    </Modal>
  );
}

/** Rücknahme einer Ausgabe aus der Liste heraus — endgültig, deshalb mit Rückfrage (Spec). */
export function RuecknahmeDialog({
  ausgabe: a,
  zeitfenster,
  ...rest
}: DialogBasis & {
  ausgabe: VerpflegungAusgabe;
  zeitfenster: Pick<VerpflegungZeitfenster, 'bezeichnung'>;
  onBestaetigen: () => void;
}) {
  const { konventionen } = useAnzeigeKonventionen();
  const sk = sonderkostText(a.sonderkost);
  return (
    <Rueckfrage
      titel="Ausgabe zurücknehmen?"
      okText="Zurücknehmen"
      fehlerTitel="Rücknahme fehlgeschlagen"
      {...rest}
    >
      <Typography.Paragraph>
        {a.menge} EP um {uhrzeit(a.zeitpunkt_at, konventionen)}
        {a.ort ? ` (${a.ort})` : ''} zu {zitat(zeitfenster.bezeichnung)}
        {sk ? `, ${sk}` : ''}.
      </Typography.Paragraph>
      <Typography.Paragraph>
        Die Rücknahme ist endgültig: Die Ausgabe bleibt als „zurückgenommen“ sichtbar und zählt
        nicht mehr in die ausgegebene Menge.
      </Typography.Paragraph>
    </Rueckfrage>
  );
}

/** Löschen eines Zeitfensters ohne gültige Ausgabe — unumkehrbar, mit Rückfrage (D7). */
export function LoeschenDialog({
  zeitfenster,
  ...rest
}: DialogBasis & {
  zeitfenster: Pick<VerpflegungZeitfenster, 'bezeichnung'>;
  onBestaetigen: () => void;
}) {
  return (
    <Rueckfrage
      titel={`Zeitfenster ${zitat(zeitfenster.bezeichnung)} löschen?`}
      okText="Löschen"
      fehlerTitel="Löschen fehlgeschlagen"
      {...rest}
    >
      <Typography.Paragraph>
        Das Zeitfenster und sein Bedarf werden entfernt. Das Einsatztagebuch hält die Löschung fest.
      </Typography.Paragraph>
    </Rueckfrage>
  );
}
