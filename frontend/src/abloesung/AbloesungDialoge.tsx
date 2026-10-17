import { Checkbox, Form, Input, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useId } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeitMitTag } from '../anzeige/format';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import type { Abloesung, VollzugBody } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { abschnittVorgabe, einsatzVorgabe } from '../components/vorgabeText';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { ABLOESUNG_ABLOESER_MAX, ABLOESUNG_RHYTHMUS_MAX_MINUTEN } from '../api/eingabegrenzen';
import { abloeserIds } from './abloeser';
import { dauerFeldText, dauerMinuten, dauerRegel, formatDauer } from './dauer';

/**
 * Die Erfassungsmasken der Ablösung, alle auf `ErfassungsModal`; höchstens drei Felder je Dialog
 * (der Vollzug: Ablöser, Zeitpunkt, „Abschnitt übergeben“).
 * Der Rhythmus wird als DAUER erfasst und angezeigt („8 h“, „7:30 h“, nie „8.0“, LLH-1122,
 * `abloesung/dauer.ts`) und als Minuten gesendet — die Lage spricht in „6-Stunden-Rhythmus",
 * nicht in 360 Minuten. Zeiten stehen in der Anzeigezone (`ZeitpunktEingabe`, LFH-692).
 *
 * Kein „Leer: …“ unter den Feldern (LFH-1078, `frontend/AGENTS.md`, „Texte: zeigen statt
 * erklären“): was ein leeres Feld bewirkt, steht als Platzhalter im Feld — der Wert, den der
 * Server dann nimmt, und nur, wenn er bekannt ist.
 */

const ZEITFORMAT = 'YYYY-MM-DD HH:mm';

export interface EinheitOption {
  value: number;
  label: string;
}

/** Kleinster Rhythmus, den die Masken annehmen: eine halbe Stunde. */
const RHYTHMUS_MIN_MINUTEN = 30;

/**
 * Das Rhythmusfeld als Dauer. `required` setzt nur die Pflichtmarke (und `aria-required`); die
 * Prüfung selbst trägt `dauerRegel`, auch für ein leeres Pflichtfeld.
 */
const rhythmusField = (platzhalter: string | undefined, pflicht: boolean) => (
  <Form.Item
    name="rhythmus"
    label="Rhythmus"
    required={pflicht}
    rules={[
      dauerRegel({
        pflicht,
        min: RHYTHMUS_MIN_MINUTEN,
        max: ABLOESUNG_RHYTHMUS_MAX_MINUTEN,
        pflichtText: 'Bitte einen Rhythmus angeben',
      }),
    ]}
  >
    <Input placeholder={platzhalter} autoComplete="off" />
  </Form.Item>
);

// ── Schicht beginnen ──────────────────────────────────────────────────────────

interface BeginnWerte {
  einheit_id: number;
  beginn?: Dayjs | null;
  rhythmus?: string;
}

interface SchichtBeginnenProps {
  offen: boolean;
  /** Einheiten OHNE laufende Schicht. */
  einheiten: EinheitOption[];
  /** Vorbelegte Einheit — aus einer Zeile „Ohne Schicht“ (LLH-1128); wählbar bleibt jede. */
  vorbelegt?: number;
  /** Einheit → Vorgabe ihres Abschnitts in Minuten (fehlt = keine Vorgabe). */
  vorgabeJeEinheit: Map<number, number>;
  /**
   * Die Vorgabe des Einsatzes als Kurztext („12 h“, „Wechsel 0600/1800“, LLH-1122); fehlt, wenn
   * der Einsatz keine hat. Sie gilt für jede Einheit, deren Abschnitt keine Vorgabe hat.
   */
  einsatzVorgabe?: string;
  /**
   * Einheit → Eintreffen ihrer offenen Einsatzperiode (fehlt = keins, der Server nimmt „jetzt“);
   * `null`, solange die Perioden nicht bekannt sind — dann verspricht der Platzhalter nichts.
   */
  eintreffenJeEinheit?: Map<number, string> | null;
  laeuft: boolean;
  fehler: unknown;
  onErfassen: (body: {
    einheit_id: number;
    beginn_at?: string;
    rhythmus_minuten?: number;
  }) => Promise<unknown>;
  onSchliessen: () => void;
}

export function SchichtBeginnenDialog({
  offen,
  einheiten,
  vorbelegt,
  vorgabeJeEinheit,
  einsatzVorgabe: einsatzVorgabeText,
  eintreffenJeEinheit = null,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: SchichtBeginnenProps) {
  const [form] = Form.useForm<BeginnWerte>();
  const { konventionen } = useAnzeigeKonventionen();
  const einheitId = Form.useWatch('einheit_id', form);
  const vorgabe = einheitId != null ? vorgabeJeEinheit.get(einheitId) : undefined;
  // Wie der Server (`abloesung/repo.rs`, `offenes_eintreffen_tx`): das Eintreffen der offenen
  // Periode, ohne eins „jetzt“.
  const eintreffen = einheitId != null ? eintreffenJeEinheit?.get(einheitId) : undefined;
  const beginnPlatzhalter =
    einheitId == null || eintreffenJeEinheit == null
      ? undefined
      : eintreffen != null
        ? `Eintreffen ${formatUhrzeitMitTag(eintreffen, konventionen)}`
        : 'jetzt';
  return (
    <ErfassungsModal<BeginnWerte>
      offen={offen}
      titel="Schicht beginnen"
      form={form}
      initialValues={vorbelegt != null ? { einheit_id: vorbelegt } : undefined}
      erfassenText="Schicht beginnen"
      laeuft={laeuft}
      onErfassen={(w) =>
        onErfassen({
          einheit_id: w.einheit_id,
          beginn_at: w.beginn ? alsBackendZeit(w.beginn) : undefined,
          rhythmus_minuten: dauerMinuten(w.rhythmus) ?? undefined,
        })
      }
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<BeginnWerte>
        name="einheit_id"
        label="Einheit"
        rules={[{ required: true, message: 'Bitte eine Einheit auswählen' }]}
      >
        <Select
          placeholder="Einheit auswählen…"
          options={einheiten}
          notFoundContent="Alle Einheiten haben bereits eine laufende Schicht"
        />
      </Form.Item>
      <Form.Item<BeginnWerte> name="beginn" label="Im Einsatz seit">
        <ZeitpunktEingabe
          format={ZEITFORMAT}
          placeholder={beginnPlatzhalter}
          style={{ width: '100%' }}
        />
      </Form.Item>
      {/* Vor der Wahl der Einheit gibt es keinen Abschnitt, dessen Vorgabe gälte, und keine
          Pflicht (LFH-948). Rangfolge wie im Server: Abschnitt vor Einsatz (LLH-1122). Ohne
          beide zeigt die Pflichtmarke, dass ein Wert fehlt. */}
      {einheitId == null
        ? rhythmusField(undefined, false)
        : rhythmusField(
            vorgabe != null
              ? abschnittVorgabe(formatDauer(vorgabe))
              : einsatzVorgabeText != null
                ? einsatzVorgabe(einsatzVorgabeText)
                : undefined,
            vorgabe == null && einsatzVorgabeText == null,
          )}
      <SpeicherFehler fehler={fehler} titel="Schicht konnte nicht begonnen werden" />
    </ErfassungsModal>
  );
}

// ── Vollzug ───────────────────────────────────────────────────────────────────

interface VollzugWerte {
  zeitpunkt?: Dayjs | null;
  abloeser_ids?: number[];
  abschnitt_uebergeben?: boolean;
}

interface VollzugProps {
  schicht: Abloesung | null;
  /** Mögliche Ablöser (`abloesung/abloeser.ts:abloeserOptionen`). */
  einheiten: EinheitOption[];
  /**
   * Abschnitt der abgelösten Einheit, den „Abschnitt übergeben“ an die Ablöser gäbe (LLH-1132);
   * fehlt, wenn sie keinen hat — dann gibt es nichts zu übergeben und keine Option.
   */
  abschnittName?: string | null;
  /** Grund in wenigen Wörtern, warum die Übergabe gesperrt ist (Modul Einheiten). */
  uebergabeGesperrt?: string;
  laeuft: boolean;
  fehler: unknown;
  onErfassen: (body: VollzugBody) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * Vollzug (LLH-1132): die Ablöser als Liste (höchstens `ABLOESUNG_ABLOESER_MAX`, vorbelegt mit
 * der Planung), der Zeitpunkt und „Abschnitt übergeben“ — vorbelegt, sobald die abgelöste
 * Einheit einen Abschnitt hat. Ohne Freigabe des Moduls Einheiten steht die Option gesperrt mit
 * Grund daneben (der Server lehnte sie mit 403 ab). Drei Felder, Feldbudget eines Modals.
 */
export function VollzugDialog({
  schicht,
  einheiten,
  abschnittName,
  uebergabeGesperrt,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: VollzugProps) {
  const [form] = Form.useForm<VollzugWerte>();
  const grundId = useId();
  const uebergabeMoeglich = abschnittName != null && uebergabeGesperrt == null;
  return (
    <ErfassungsModal<VollzugWerte>
      offen={schicht != null}
      titel={schicht ? `Ablösung ${schicht.einheit_name} vollziehen` : 'Ablösung vollziehen'}
      form={form}
      erfassenText="Vollziehen"
      laeuft={laeuft}
      initialValues={{
        abloeser_ids: schicht ? abloeserIds(schicht) : [],
        abschnitt_uebergeben: uebergabeMoeglich,
      }}
      onErfassen={(w) => {
        const ids = w.abloeser_ids ?? [];
        return onErfassen({
          vollzogen_at: w.zeitpunkt ? alsBackendZeit(w.zeitpunkt) : undefined,
          abloeser_ids: ids,
          // Ohne Ablöser gibt es niemanden, dem der Abschnitt ginge; der Server übergäbe nichts.
          abschnitt_uebergeben: uebergabeMoeglich && ids.length > 0 && w.abschnitt_uebergeben,
        });
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<VollzugWerte> name="abloeser_ids" label="Ablösende Einheiten">
        <Select
          mode="multiple"
          allowClear
          maxCount={ABLOESUNG_ABLOESER_MAX}
          placeholder="ohne ablösende Einheit"
          options={einheiten}
        />
      </Form.Item>
      <Form.Item<VollzugWerte> name="zeitpunkt" label="Zeitpunkt">
        <ZeitpunktEingabe format={ZEITFORMAT} placeholder="jetzt" style={{ width: '100%' }} />
      </Form.Item>
      {abschnittName != null && (
        <Form.Item<VollzugWerte> name="abschnitt_uebergeben" valuePropName="checked">
          <Checkbox
            disabled={uebergabeGesperrt != null}
            aria-describedby={uebergabeGesperrt != null ? grundId : undefined}
          >
            Abschnitt übergeben ({abschnittName})
          </Checkbox>
        </Form.Item>
      )}
      {abschnittName != null && uebergabeGesperrt != null && (
        <Typography.Text type="secondary" id={grundId} data-lfh="vollzug-uebergabe-gesperrt">
          {uebergabeGesperrt}
        </Typography.Text>
      )}
      <SpeicherFehler fehler={fehler} titel="Ablösung konnte nicht vollzogen werden" />
    </ErfassungsModal>
  );
}

// ── Ablöser planen ────────────────────────────────────────────────────────────

interface AbloeserWerte {
  abloeser_ids?: number[];
}

interface AbloeserProps {
  schicht: Abloesung | null;
  einheiten: EinheitOption[];
  laeuft: boolean;
  fehler: unknown;
  /** Die geplanten Ablöser in ihrer Reihenfolge; leer = Planung aufheben. */
  onErfassen: (abloeserIds: number[]) => Promise<unknown>;
  onSchliessen: () => void;
}

/** Ablöser planen (LLH-1132): eine Liste wie im Vollzug, sie ersetzt die bisherige Planung. */
export function AbloeserDialog({
  schicht,
  einheiten,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: AbloeserProps) {
  const [form] = Form.useForm<AbloeserWerte>();
  return (
    <ErfassungsModal<AbloeserWerte>
      offen={schicht != null}
      titel={schicht ? `Ablösung ${schicht.einheit_name} planen` : 'Ablösung planen'}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      initialValues={{ abloeser_ids: schicht ? abloeserIds(schicht) : [] }}
      onErfassen={(w) => onErfassen(w.abloeser_ids ?? [])}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<AbloeserWerte> name="abloeser_ids" label="Ablösende Einheiten">
        <Select
          mode="multiple"
          allowClear
          maxCount={ABLOESUNG_ABLOESER_MAX}
          placeholder="keine geplant"
          options={einheiten}
        />
      </Form.Item>
      <SpeicherFehler fehler={fehler} titel="Planung konnte nicht gespeichert werden" />
    </ErfassungsModal>
  );
}

// ── Rhythmus (Schicht oder Abschnitt) ─────────────────────────────────────────

interface RhythmusWerte {
  rhythmus?: string;
}

interface RhythmusProps {
  offen: boolean;
  titel: string;
  /** Vorbelegung in Minuten. */
  minuten: number | null;
  /**
   * Was bei leerem Feld gilt, als Platzhalter: „6 h (Vorgabe Abschnitt)“, „12 h (Vorgabe Einsatz)“
   * bzw. „keine Vorgabe“; fehlt er, zeigt die Pflichtmarke, dass ein Wert nötig ist.
   */
  platzhalter?: string;
  /** Darf das Feld leer bleiben? */
  leerErlaubt: boolean;
  laeuft: boolean;
  fehler: unknown;
  onErfassen: (minuten: number | null) => Promise<unknown>;
  onSchliessen: () => void;
}

/** Ein Feld: Rhythmus als Dauer. Für die Schicht („eigener Wert") und die Abschnittsvorgabe. */
export function RhythmusDialog({
  offen,
  titel,
  minuten,
  platzhalter,
  leerErlaubt,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: RhythmusProps) {
  const [form] = Form.useForm<RhythmusWerte>();
  return (
    <ErfassungsModal<RhythmusWerte>
      offen={offen}
      titel={titel}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      initialValues={{ rhythmus: dauerFeldText(minuten) }}
      onErfassen={(w) => onErfassen(dauerMinuten(w.rhythmus))}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {rhythmusField(platzhalter, !leerErlaubt)}
      <SpeicherFehler fehler={fehler} titel="Rhythmus konnte nicht gespeichert werden" />
    </ErfassungsModal>
  );
}
