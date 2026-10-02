import { Form, InputNumber } from 'antd';
import type { Dayjs } from 'dayjs';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import type { Abloesung } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { rhythmusText } from './einstufung';

/**
 * Die Erfassungsmasken der Ablösung, alle auf `ErfassungsModal`; höchstens drei Felder je Dialog.
 * Der Rhythmus wird in STUNDEN erfasst (0,5er-Schritte) und als Minuten gesendet — die Lage
 * spricht in „6-Stunden-Rhythmus", nicht in 360 Minuten. Zeiten stehen in der Anzeigezone
 * (`ZeitpunktEingabe`, LFH-692).
 */

const ZEITFORMAT = 'YYYY-MM-DD HH:mm';

export interface EinheitOption {
  value: number;
  label: string;
}

/** Stunden aus dem Feld → Minuten für das Backend; leer → `undefined`. */
function stundenAlsMinuten(stunden: number | null | undefined): number | undefined {
  if (stunden == null || Number.isNaN(stunden)) return undefined;
  return Math.round(stunden * 60);
}

const rhythmusFeld = (extra: string, pflicht: boolean) => (
  <Form.Item
    name="rhythmus_stunden"
    label="Rhythmus (Stunden)"
    extra={extra}
    rules={pflicht ? [{ required: true, message: 'Bitte einen Rhythmus angeben' }] : []}
  >
    <InputNumber min={0.5} max={168} step={0.5} style={{ width: '100%' }} />
  </Form.Item>
);

// ── Schicht beginnen ──────────────────────────────────────────────────────────

interface BeginnWerte {
  einheit_id: number;
  beginn?: Dayjs | null;
  rhythmus_stunden?: number | null;
}

interface SchichtBeginnenProps {
  offen: boolean;
  /** Einheiten OHNE laufende Schicht. */
  einheiten: EinheitOption[];
  /** Einheit → Vorgabe ihres Abschnitts in Minuten (fehlt = keine Vorgabe). */
  vorgabeJeEinheit: Map<number, number>;
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
  vorgabeJeEinheit,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: SchichtBeginnenProps) {
  const [form] = Form.useForm<BeginnWerte>();
  const einheitId = Form.useWatch('einheit_id', form);
  const vorgabe = einheitId != null ? vorgabeJeEinheit.get(einheitId) : undefined;
  return (
    <ErfassungsModal<BeginnWerte>
      offen={offen}
      titel="Schicht beginnen"
      form={form}
      erfassenText="Schicht beginnen"
      laeuft={laeuft}
      onErfassen={(w) =>
        onErfassen({
          einheit_id: w.einheit_id,
          beginn_at: w.beginn ? alsBackendZeit(w.beginn) : undefined,
          rhythmus_minuten: stundenAlsMinuten(w.rhythmus_stunden),
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
      <Form.Item<BeginnWerte>
        name="beginn"
        label="Im Einsatz seit"
        extra="Leer: Eintreffen laut Kräfte-Zeitachse, sonst jetzt"
      >
        <ZeitpunktEingabe format={ZEITFORMAT} style={{ width: '100%' }} />
      </Form.Item>
      {rhythmusFeld(
        vorgabe != null
          ? `Leer: Vorgabe des Abschnitts (${rhythmusText(vorgabe)})`
          : 'Der Abschnitt der Einheit hat keine Vorgabe',
        vorgabe == null,
      )}
      <SpeicherFehler fehler={fehler} titel="Schicht konnte nicht begonnen werden" />
    </ErfassungsModal>
  );
}

// ── Vollzug ───────────────────────────────────────────────────────────────────

interface VollzugWerte {
  zeitpunkt?: Dayjs | null;
  abloesende_einheit_id?: number | null;
}

interface VollzugProps {
  schicht: Abloesung | null;
  /** Mögliche Ablöser: andere Einheiten ohne laufende Schicht. */
  einheiten: EinheitOption[];
  laeuft: boolean;
  fehler: unknown;
  onErfassen: (body: { vollzogen_at?: string; abloesende_einheit_id?: number }) => Promise<unknown>;
  onSchliessen: () => void;
}

export function VollzugDialog({
  schicht,
  einheiten,
  laeuft,
  fehler,
  onErfassen,
  onSchliessen,
}: VollzugProps) {
  const [form] = Form.useForm<VollzugWerte>();
  return (
    <ErfassungsModal<VollzugWerte>
      offen={schicht != null}
      titel={schicht ? `Ablösung ${schicht.einheit_name} vollziehen` : 'Ablösung vollziehen'}
      form={form}
      erfassenText="Vollziehen"
      laeuft={laeuft}
      initialValues={{ abloesende_einheit_id: schicht?.abloesende_einheit_id ?? undefined }}
      onErfassen={(w) =>
        onErfassen({
          vollzogen_at: w.zeitpunkt ? alsBackendZeit(w.zeitpunkt) : undefined,
          abloesende_einheit_id: w.abloesende_einheit_id ?? undefined,
        })
      }
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<VollzugWerte>
        name="abloesende_einheit_id"
        label="Ablösende Einheit"
        extra="Für sie beginnt die Folgeschicht mit demselben Rhythmus. Leer: ohne Ablöser."
      >
        <Select allowClear placeholder="ohne ablösende Einheit" options={einheiten} />
      </Form.Item>
      <Form.Item<VollzugWerte> name="zeitpunkt" label="Zeitpunkt" extra="Leer: jetzt">
        <ZeitpunktEingabe format={ZEITFORMAT} style={{ width: '100%' }} />
      </Form.Item>
      <SpeicherFehler fehler={fehler} titel="Ablösung konnte nicht vollzogen werden" />
    </ErfassungsModal>
  );
}

// ── Ablöser planen ────────────────────────────────────────────────────────────

interface AbloeserWerte {
  abloesende_einheit_id?: number | null;
}

interface AbloeserProps {
  schicht: Abloesung | null;
  einheiten: EinheitOption[];
  laeuft: boolean;
  fehler: unknown;
  onErfassen: (abloesendeEinheitId: number | null) => Promise<unknown>;
  onSchliessen: () => void;
}

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
      initialValues={{ abloesende_einheit_id: schicht?.abloesende_einheit_id ?? undefined }}
      onErfassen={(w) => onErfassen(w.abloesende_einheit_id ?? null)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item<AbloeserWerte>
        name="abloesende_einheit_id"
        label="Ablösende Einheit"
        extra="Leer: Planung aufheben"
      >
        <Select allowClear placeholder="keine geplant" options={einheiten} />
      </Form.Item>
      <SpeicherFehler fehler={fehler} titel="Planung konnte nicht gespeichert werden" />
    </ErfassungsModal>
  );
}

// ── Rhythmus (Schicht oder Abschnitt) ─────────────────────────────────────────

interface RhythmusWerte {
  rhythmus_stunden?: number | null;
}

interface RhythmusProps {
  offen: boolean;
  titel: string;
  /** Vorbelegung in Minuten. */
  minuten: number | null;
  /** Was ein leeres Feld bedeutet — „Vorgabe des Abschnitts" bzw. „Vorgabe entfernen". */
  leerText: string;
  /** Darf das Feld leer bleiben? */
  leerErlaubt: boolean;
  laeuft: boolean;
  fehler: unknown;
  onErfassen: (minuten: number | null) => Promise<unknown>;
  onSchliessen: () => void;
}

/** Ein Feld: Rhythmus in Stunden. Für die Schicht („eigener Wert") und die Abschnittsvorgabe. */
export function RhythmusDialog({
  offen,
  titel,
  minuten,
  leerText,
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
      initialValues={{ rhythmus_stunden: minuten != null ? minuten / 60 : undefined }}
      onErfassen={(w) => onErfassen(stundenAlsMinuten(w.rhythmus_stunden) ?? null)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {rhythmusFeld(leerText, !leerErlaubt)}
      <SpeicherFehler fehler={fehler} titel="Rhythmus konnte nicht gespeichert werden" />
    </ErfassungsModal>
  );
}
