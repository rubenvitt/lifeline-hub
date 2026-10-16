import { Collapse, Form, Input, InputNumber, Modal, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { VERPFLEGUNG_EP_MAX } from '../api/eingabegrenzen';
import type {
  AusgabeEingabe,
  Kostform,
  ModulFreigaben,
  SonderkostEingabe,
  VerpflegungAusgabe,
  Verpflegungsart,
  Verpflegungsstelle,
  VerpflegungZeitfenster,
  ZeitfensterEingabe,
  ZeitfensterPatch,
} from '../api/types';
import {
  VERPFLEGUNG_BEMERKUNG_MAX,
  VERPFLEGUNG_ORT_MAX,
  VERPFLEGUNG_STELLEN_JE_ZEITFENSTER_MAX,
  VERPFLEGUNG_ZEITFENSTER_BEZEICHNUNG_MAX,
} from '../api/eingabegrenzen';
import { ErfassungsModal } from '../components/Erfassung';
import { Augenbraue } from '../components/instrument';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { ZeitpunktEingabe, ZeitraumEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { stellenWahl } from './stellenKern';
import { useBedarfsvorschlag, type Vorschlag } from './useBedarfsvorschlag';
import {
  KOSTFORM_LABEL,
  KOSTFORMEN,
  VERPFLEGUNGSART_LABEL,
  sonderkostText,
  uhrzeit,
  zitat,
} from './verpflegungText';

dayjs.extend(utc);

/**
 * Die Erfassungsmasken des Fachmoduls Verpflegung, beide auf `ErfassungsModal`;
 * Server-Gründe (400/422) stehen IM Dialog (`SpeicherFehler`).
 *
 * FELDBUDGET: „Zeitfenster" zeigt bewusst VIER Felder, weil die beiden Bedarfsteile je einen
 * Vorschlag mit Herkunft tragen, der eingeklappt unsichtbar wäre; „Ausgabe nachtragen" drei. Der
 * Rest liegt in einem `Collapse` mit `forceRender`, sonst fehlen die Werte in `onFinish`.
 *
 * ZEIT: Wire-Zeiten sind UTC ohne Zone — hinaus über `alsBackendZeit`, herein über
 * `alsZeitpunkt`, nie `dayjs(s)`; die Felder zeigen und lesen die Anzeigezone (`ZeitraumEingabe`,
 * `ZeitpunktEingabe`, LFH-692). Ein LEERER Ausgabezeitpunkt lässt den Schlüssel weg: „jetzt"
 * setzt der Server.
 *
 * PATCH: Schlüssel fehlt = unverändert, kein `null`. Gesendet werden nur geänderte Schlüssel;
 * ein geleertes optionales Zahlfeld heißt 0. Ein leerer PATCH wird nicht gesendet. Ausnahme
 * `verpflegungsart`: Leeren schickt `null`; `stelle_ids` ersetzt die Zuordnung (`[]` leert sie),
 * gleiche Stellen in anderer Reihenfolge sind keine Änderung.
 *
 * STELLEN (LLH-1040, design.md D13 Punkte 5–6): Art und Stellen des Zeitfensters liegen im
 * eigenen Klappteil, dessen Kopf die Wahl nennt; die Stellen nur, wenn es welche gibt. Der
 * Nachtrag zeigt „Stelle“ sichtbar; „Ort“ heißt mit Stellen im Einsatz „Zuführungsziel“ und
 * entfällt, sobald eine Stelle gewählt ist (Stelle und Zuführungsziel sind Alternativen, deshalb
 * höchstens vier sichtbare Felder).
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

interface ZeitfensterWerte {
  bezeichnung: string;
  zeitraum: [Dayjs, Dayjs];
  bedarf_kraefte: number;
  bedarf_betreute: number;
  bedarf_weitere?: number | null;
  sonderkost?: SonderkostWerte;
  verpflegungsart?: Verpflegungsart | null;
  stelle_ids?: number[];
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
    ...(w.verpflegungsart != null ? { verpflegungsart: w.verpflegungsart } : {}),
    ...(w.stelle_ids && w.stelle_ids.length > 0 ? { stelle_ids: [...w.stelle_ids] } : {}),
  };
}

/** Gleiche Stellen, gleich in welcher Reihenfolge. */
function isSameStellen(a: readonly number[], b: readonly number[]): boolean {
  const menge = new Set(a);
  return menge.size === new Set(b).size && b.every((id) => menge.has(id));
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
  const art = w.verpflegungsart ?? null;
  if (art !== (vorher.verpflegungsart ?? null)) patch.verpflegungsart = art;
  // Ohne Feld (keine Stellen im Einsatz) bleibt die Zuordnung, wie sie ist.
  if (w.stelle_ids !== undefined && !isSameStellen(w.stelle_ids, vorher.stelle_ids)) {
    patch.stelle_ids = [...w.stelle_ids];
  }
  return patch;
}

// ── Ausgabe: reine Abbildung ────────────────────────────────────────────────────────────

interface AusgabeWerte {
  menge: number;
  ort?: string | null;
  zeitpunkt?: Dayjs | null;
  sonderkost?: SonderkostWerte;
  nachforderung_id?: number | null;
  bemerkung?: string | null;
  verpflegungsstelle_id?: number | null;
}

export function ausgabeBody(w: AusgabeWerte): AusgabeEingabe {
  const stelle = w.verpflegungsstelle_id ?? null;
  // Stelle und Zuführungsziel sind Alternativen: an einer Stelle zählt kein Ort.
  const ort = stelle != null ? null : text(w.ort);
  const bemerkung = text(w.bemerkung);
  const sonderkost = sonderkostAnlegen(w.sonderkost);
  return {
    menge: w.menge,
    ...(w.zeitpunkt ? { zeitpunkt_at: alsBackendZeit(w.zeitpunkt) } : {}),
    ...(ort != null ? { ort } : {}),
    ...(stelle != null ? { verpflegungsstelle_id: stelle } : {}),
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
function eingeklappt(
  label: string,
  children: ReactNode,
  offen?: { offen: boolean; setOffen: (offen: boolean) => void },
) {
  return (
    <Collapse
      ghost
      {...(offen
        ? {
            activeKey: offen.offen ? ['weitere'] : [],
            onChange: (k: string | string[]) => offen.setOffen([k].flat().includes('weitere')),
          }
        : {})}
      items={[{ key: 'weitere', label, forceRender: true, children }]}
    />
  );
}

/**
 * Sonderkost ist eine Teilmenge der Essensportionen (bzw. der Menge), kein Zuschlag — das sagt
 * die Gruppenbeschriftung „davon“; die Obergrenze prüft der Server (422 im Dialog).
 */
function sonderkostFelder() {
  return (
    <>
      <Augenbraue als="div" style={{ marginBottom: 8 }}>
        davon Sonderkost (EP)
      </Augenbraue>
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

const VERPFLEGUNGSART_OPTIONEN = (Object.keys(VERPFLEGUNGSART_LABEL) as Verpflegungsart[]).map(
  (a) => ({ value: a, label: VERPFLEGUNGSART_LABEL[a] }),
);

/**
 * Wählbare Stellen eines Zeitfensters: die nicht aufgelösten in der Folge des Servers, dazu die
 * schon zugeordneten aufgelösten (sie dürfen bleiben, D4; eine neu hinzukommende aufgelöste lehnt
 * der Server ab und wird deshalb nicht angeboten).
 */
function zeitfensterStellenOptionen(
  stellen: readonly Verpflegungsstelle[],
  vorher: Pick<VerpflegungZeitfenster, 'stelle_ids'> | null,
): { value: number; label: string }[] {
  const zugeordnet = new Set(vorher?.stelle_ids ?? []);
  return [
    ...stellen
      .filter((s) => s.status !== 'aufgeloest')
      .map((s) => ({ value: s.id, label: s.bezeichnung })),
    ...stellen
      .filter((s) => s.status === 'aufgeloest' && zugeordnet.has(s.id))
      .map((s) => ({ value: s.id, label: `${s.bezeichnung} (aufgelöst)` })),
  ];
}

/**
 * Feldhilfe eines Bedarfsfelds. Beim ANLEGEN steht der Vorschlag im Feld, die Hilfe nennt nur
 * die Herkunft; beim BEARBEITEN überschreibt der Vorschlag nichts, die Hilfe nennt die Zahl mit.
 */
function vorschlagHilfe(v: Vorschlag, anlegen: boolean): string | undefined {
  if (v.hinweis == null) return undefined;
  if (anlegen || v.wert == null) return v.hinweis;
  return `Aktuell ${v.wert} — ${v.hinweis}`;
}

type ZeitfensterModus =
  | { art: 'anlegen'; onErfassen: (body: ZeitfensterEingabe) => Promise<unknown> }
  | {
      art: 'bearbeiten';
      zeitfenster: VerpflegungZeitfenster;
      onErfassen: (patch: ZeitfensterPatch) => Promise<unknown>;
    };

interface ZeitfensterDialogProps extends DialogBasis {
  modus: ZeitfensterModus;
  einsatzId: number;
  /** `freigabenQuery.data` unverändert — `undefined` heißt „noch unbekannt" (Hook-Vertrag). */
  freigaben: ModulFreigaben | undefined;
  jetzt: Dayjs;
  /** Die Verpflegungsstellen des Einsatzes (LLH-1040); ohne gibt es kein Feld „Stellen“. */
  stellen?: readonly Verpflegungsstelle[];
}

type Bedarfsfeld = 'bedarf_kraefte' | 'bedarf_betreute';

export function ZeitfensterDialog({
  modus,
  einsatzId,
  freigaben,
  jetzt,
  stellen = [],
  laeuft,
  fehler,
  onSchliessen,
}: ZeitfensterDialogProps) {
  const [form] = Form.useForm<ZeitfensterWerte>();
  const anlegen = modus.art === 'anlegen';
  const vorher = modus.art === 'bearbeiten' ? modus.zeitfenster : null;
  // Die Grenze der Stellen kann scheitern: der Klappteil geht dann selbst auf.
  const [stellenOffen, setStellenOffen] = useState(false);
  const hasStellen = stellen.length > 0;
  const art = Form.useWatch('verpflegungsart', form) as Verpflegungsart | null | undefined;
  const gewaehlteStellen = (Form.useWatch('stelle_ids', form) as number[] | undefined) ?? [];
  const stellenOptionen = zeitfensterStellenOptionen(stellen, vorher);
  const stellenKopf = [
    hasStellen ? 'Art und Stellen' : 'Art',
    art ? VERPFLEGUNGSART_LABEL[art] : undefined,
    gewaehlteStellen.length > 0
      ? `${gewaehlteStellen.length} ${gewaehlteStellen.length === 1 ? 'Stelle' : 'Stellen'}`
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  // Der Beginn geht als Wire-String in den Query-Key der Kopfzahl — nie ein je Render neu
  // gerechnetes „jetzt".
  const zeitraum = Form.useWatch('zeitraum', form) as [Dayjs | null, Dayjs | null] | undefined;
  const beginn = zeitraum?.[0];
  // Im ersten Render ist `useWatch` noch leer — beim Bearbeiten gilt bis dahin der gespeicherte
  // Beginn, sonst ginge eine Kopfzahl-Anfrage „jetzt" hinaus.
  const vonAt =
    beginn && beginn.isValid()
      ? alsBackendZeit(beginn)
      : zeitraum === undefined && vorher
        ? normalisiert(vorher.von_at)
        : undefined;
  const vorschlag = useBedarfsvorschlag({ einsatzId, vonAt, freigaben, jetzt });

  // Eigener Merker statt `isFieldTouched`: eine Vorbelegung per `setFieldValue` wäre sonst von der
  // Hand der Person nicht zu trennen, und ein nachziehender Vorschlag überschriebe ihre Zahl.
  const beruehrt = useRef<Record<Bedarfsfeld, boolean>>({
    bedarf_kraefte: false,
    bedarf_betreute: false,
  });
  const { wert: kraefteWert, hinweis: kraefteHinweis } = vorschlag.kraefte;
  const { wert: betreuteWert, hinweis: betreuteHinweis } = vorschlag.betreute;
  // Nur beim ANLEGEN, und nur wenn die Quelle geantwortet hat (`hinweis`): während sie lädt, ist
  // `wert` ebenfalls `null`, und ein Leeren ließe die Zahl flackern.
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
        zeitraum: [alsZeitpunkt(vorher.von_at)!, alsZeitpunkt(vorher.bis_at)!],
        bedarf_kraefte: vorher.bedarf.kraefte,
        bedarf_betreute: vorher.bedarf.betreute,
        bedarf_weitere: vorher.bedarf.weitere,
        sonderkost: { ...vorher.bedarf.sonderkost },
        verpflegungsart: vorher.verpflegungsart ?? undefined,
        ...(hasStellen ? { stelle_ids: [...vorher.stelle_ids] } : {}),
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
      onPruefungGescheitert={(felder) => {
        if (felder.includes('stelle_ids')) setStellenOffen(true);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<ZeitfensterWerte>
        name="bezeichnung"
        label="Bezeichnung"
        rules={[
          { required: true, whitespace: true, message: 'Bitte eine Bezeichnung angeben' },
          zeichenRegel(VERPFLEGUNG_ZEITFENSTER_BEZEICHNUNG_MAX, 'Bezeichnung'),
        ]}
      >
        <Input
          placeholder="z. B. Mittag"
          count={zeichenGrenze(VERPFLEGUNG_ZEITFENSTER_BEZEICHNUNG_MAX)}
        />
      </Form.Item>
      <Form.Item<ZeitfensterWerte>
        name="zeitraum"
        label="Zeitraum"
        rules={[{ required: true, message: 'Bitte Beginn und Ende angeben' }]}
      >
        <ZeitraumEingabe
          format={ZEITFORMAT}
          placeholder={['Beginn', 'Ende']}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item<ZeitfensterWerte>
        name="bedarf_kraefte"
        label="Einsatzkräfte (EP)"
        extra={
          // Einmal am ersten Feld, sichtbar statt Tooltip: am Tablet gibt es kein Hover (LFH-948).
          <>
            <div>EP = Essensportionen</div>
            <div>{vorschlagHilfe(vorschlag.kraefte, anlegen)}</div>
          </>
        }
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
          {sonderkostFelder()}
        </>,
      )}
      {eingeklappt(
        stellenKopf,
        <>
          <Form.Item<ZeitfensterWerte>
            name="verpflegungsart"
            label="Art"
            style={hasStellen ? undefined : { marginBottom: 0 }}
          >
            <Select allowClear placeholder="ohne Angabe" options={VERPFLEGUNGSART_OPTIONEN} />
          </Form.Item>
          {hasStellen && (
            <Form.Item<ZeitfensterWerte>
              name="stelle_ids"
              label="Stellen"
              rules={[
                {
                  type: 'array',
                  max: VERPFLEGUNG_STELLEN_JE_ZEITFENSTER_MAX,
                  message: `Höchstens ${VERPFLEGUNG_STELLEN_JE_ZEITFENSTER_MAX} Stellen`,
                },
              ]}
              style={{ marginBottom: 0 }}
            >
              <Select mode="multiple" placeholder="einsatzweit" options={stellenOptionen} />
            </Form.Item>
          )}
        </>,
        { offen: stellenOffen, setOffen: setStellenOffen },
      )}
      <SpeicherFehler
        fehler={fehler}
        titel={anlegen ? 'Zeitfenster konnte nicht angelegt werden' : 'Bedarf nicht gespeichert'}
      />
    </ErfassungsModal>
  );
}

// ── Ausgabe nachtragen ──────────────────────────────────────────────────────────────────

export interface NachforderungOption {
  value: number;
  label: string;
}

interface AusgabeDialogProps extends DialogBasis {
  zeitfenster: VerpflegungZeitfenster;
  /**
   * Nachforderungen zur Auswahl. `null` = Modul für die Person nicht bedienbar, dann gibt es das
   * Feld nicht.
   */
  nachforderungen: readonly NachforderungOption[] | null;
  /** Die Verpflegungsstellen des Einsatzes (LLH-1040); ohne gibt es keine Stellenwahl. */
  stellen?: readonly Verpflegungsstelle[];
  onErfassen: (body: AusgabeEingabe) => Promise<unknown>;
}

/**
 * Gruppen der Stellenwahl im Nachtrag: die zugeordneten zuerst, die aufgelösten für Nachträge vor
 * der Auflösung als eigene Gruppe (der Server prüft den Zeitpunkt, 409).
 */
function nachtragStellenOptionen(
  stellen: readonly Verpflegungsstelle[],
  zf: VerpflegungZeitfenster,
): { label: string; options: { value: number; label: string }[] }[] {
  const wahl = stellenWahl(stellen, zf);
  const toOption = (s: Verpflegungsstelle) => ({ value: s.id, label: s.bezeichnung });
  return [
    { label: 'zugeordnet', options: wahl.zugeordnet.map(toOption) },
    {
      label: wahl.zugeordnet.length > 0 ? 'weitere' : 'Stellen',
      options: wahl.weitere.map(toOption),
    },
    { label: 'aufgelöst', options: wahl.aufgeloest.map(toOption) },
  ].filter((g) => g.options.length > 0);
}

/**
 * „Ausgabe nachtragen“ (LLH-1032, design.md D8): der Nebenweg neben dem Zählen in der
 * Ausgabeansicht, für Papierlisten, einen Zeitpunkt in der Vergangenheit, Ort, Nachforderung und
 * Bemerkung. Die Menge lässt nicht mehr zu als der Server (`VERPFLEGUNG_EP_MAX`).
 */
export function AusgabeDialog({
  zeitfenster: zf,
  nachforderungen,
  stellen = [],
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: AusgabeDialogProps) {
  const [form] = Form.useForm<AusgabeWerte>();
  // Die Bemerkung kann an ihrer Grenze scheitern: der Klappteil geht dann selbst auf, und sein
  // Kopf nennt jede Abweichung von der Vorgabe (`frontend/AGENTS.md`, „Ein Pflichtfeld gehört nie
  // hinter den Collapse“, LFH-974).
  const [weitereOffen, setWeitereOffen] = useState(false);
  const sonderkost = Form.useWatch('sonderkost', form) as SonderkostWerte | undefined;
  const nachforderungId = Form.useWatch('nachforderung_id', form) as number | null | undefined;
  const bemerkung = Form.useWatch('bemerkung', form) as string | null | undefined;
  const stelleId = Form.useWatch('verpflegungsstelle_id', form) as number | null | undefined;
  const hasStellen = stellen.length > 0;
  const ortLabel = hasStellen ? 'Zuführungsziel' : 'Ort';
  const abweichungen = [
    ...KOSTFORMEN.filter((k) => (sonderkost?.[k] ?? 0) > 0).map(
      (k) => `${sonderkost?.[k]} ${KOSTFORM_LABEL[k]}`,
    ),
    nachforderungId != null ? 'Nachforderung' : undefined,
    text(bemerkung) != null ? 'Bemerkung' : undefined,
  ].filter((t): t is string => !!t);
  return (
    <ErfassungsModal<AusgabeWerte>
      offen
      titel={`Ausgabe nachtragen: ${zf.bezeichnung}`}
      form={form}
      erfassenText="Nachtragen"
      laeuft={laeuft}
      onErfassen={(w) => onErfassen(ausgabeBody(w))}
      onPruefungGescheitert={(felder) => {
        if (felder.includes('bemerkung')) setWeitereOffen(true);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {/* Normaltext, nicht `secondary`: die Zeile ist die einzige Angabe der Fehlmenge im Dialog. */}
      <Typography.Paragraph style={{ fontVariantNumeric: 'tabular-nums' }}>
        Bedarf {zf.bedarf.gesamt} · ausgegeben {zf.ausgegeben.gesamt} · fehlt {zf.fehlmenge.gesamt}{' '}
        EP
      </Typography.Paragraph>
      <Form.Item<AusgabeWerte>
        name="menge"
        label="Menge (EP)"
        rules={[
          { required: true, message: 'Bitte eine Menge angeben' },
          // Regel statt `max` am Feld: das kappte still auf die Grenze und buchte trotzdem.
          {
            type: 'number',
            max: VERPFLEGUNG_EP_MAX,
            message: `Höchstens ${VERPFLEGUNG_EP_MAX} EP`,
          },
        ]}
      >
        {anzahlFeld(1)}
      </Form.Item>
      {hasStellen && (
        <Form.Item<AusgabeWerte> name="verpflegungsstelle_id" label="Stelle">
          <Select
            allowClear
            placeholder="ohne Stelle"
            options={nachtragStellenOptionen(stellen, zf)}
          />
        </Form.Item>
      )}
      {stelleId == null && (
        <Form.Item<AusgabeWerte>
          name="ort"
          label={ortLabel}
          rules={[zeichenRegel(VERPFLEGUNG_ORT_MAX, ortLabel)]}
        >
          <Input count={zeichenGrenze(VERPFLEGUNG_ORT_MAX)} />
        </Form.Item>
      )}
      <Form.Item<AusgabeWerte> name="zeitpunkt" label="Zeitpunkt">
        <ZeitpunktEingabe format={ZEITFORMAT} placeholder="jetzt" style={{ width: '100%' }} />
      </Form.Item>
      {eingeklappt(
        ['Weitere Angaben', ...abweichungen].join(' · '),
        <>
          {sonderkostFelder()}
          {nachforderungen != null && (
            <Form.Item<AusgabeWerte> name="nachforderung_id" label="Nachforderung">
              <Select
                allowClear
                placeholder="ohne Nachforderung"
                options={[...nachforderungen]}
                notFoundContent="Keine Nachforderungen im Einsatz"
              />
            </Form.Item>
          )}
          <Form.Item<AusgabeWerte>
            name="bemerkung"
            label="Bemerkung"
            rules={[zeichenRegel(VERPFLEGUNG_BEMERKUNG_MAX, 'Bemerkung')]}
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea
              autoSize={{ minRows: 2 }}
              count={zeichenGrenze(VERPFLEGUNG_BEMERKUNG_MAX)}
            />
          </Form.Item>
        </>,
        { offen: weitereOffen, setOffen: setWeitereOffen },
      )}
      <SpeicherFehler fehler={fehler} titel="Ausgabe konnte nicht nachgetragen werden" />
    </ErfassungsModal>
  );
}

// ── Rückfragen ──────────────────────────────────────────────────────────────────────────

/**
 * Rückfrage vor einer unumkehrbaren Aktion: eigenes `Modal` mit rotem Bestätigungsknopf, kein
 * `Popconfirm`. Der Aufrufer rendert EINEN Dialog außerhalb der Karten. Während `laeuft` ist sie
 * nicht schließbar, damit ein Server-Grund (422/409) im Dialog ankommt.
 */
export function Rueckfrage({
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
      // Solange die Aktion läuft, führt KEIN Weg hinaus: ein Fehlschlag danach ginge still verloren
      // (LFH-706, wie `betreuung/MeldeVerlauf.tsx`). antd 6 verwirft `onCancel` unter
      // `confirmLoading` zwar selbst, ließe „Abbrechen“ und das Kreuz aber bedienbar aussehen.
      onCancel={() => {
        if (!laeuft) onSchliessen();
      }}
      cancelButtonProps={{ disabled: laeuft }}
      closable={!laeuft}
      keyboard={!laeuft}
      mask={{ closable: !laeuft }}
      destroyOnHidden
    >
      {children}
      <SpeicherFehler fehler={fehler} titel={fehlerTitel} />
    </Modal>
  );
}

/** Rücknahme einer Ausgabe — endgültig, deshalb mit Rückfrage. */
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
      <Typography.Paragraph>Endgültig; bleibt als „zurückgenommen“ sichtbar.</Typography.Paragraph>
    </Rueckfrage>
  );
}

/** Löschen eines Zeitfensters ohne gültige Ausgabe — unumkehrbar, mit Rückfrage. */
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
      <Typography.Paragraph>Zeitfenster samt Bedarf wird gelöscht.</Typography.Paragraph>
    </Rueckfrage>
  );
}
