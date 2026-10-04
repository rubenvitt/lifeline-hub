/**
 * Zeiteingabe in der Anzeigezone (LFH-692, Fähigkeit `zeiteingabe`; Regel: `frontend/AGENTS.md`,
 * Inline-Bearbeitung). Jede Zeiteingabe der Oberfläche läuft über diese Bausteine, nie über einen
 * nackten antd-`DatePicker` (Guard `zeitEingabe.guard.test.ts`).
 *
 * `value`/`onChange` tauschen ABSOLUTE Zeitpunkte. Nur zum Picker hin wird in die Wanduhr der
 * Anzeigezone gewandelt (`zeitEingabe.ts`, Begründung dort und in
 * `openspec/changes/archive/2026-10-01-lfh-692-zeiteingabe-anzeigezone/design.md`, D1–D4):
 * - `onChange` feuert nur bei einer Eingabe — ein unberührtes Feld behält den gelesenen Zeitpunkt.
 * - antds „Jetzt“ wäre browserlokal; es ist aus, ein eigener Knopf im Panel-Fuß setzt `serverJetzt()`
 *   — jetzt nach der Serveruhr, soweit der Versatz bekannt ist (LFH-895,
 *   `openspec/changes/lfh-895-ereigniszeit-serveruhr/design.md`, D3).
 * - Weicht die Anzeigezone von der Browserzone ab, steht die Zone am Feld und im Panel-Fuß.
 */
import { Button, DatePicker, type GetRef } from 'antd';
import type { RangePickerProps } from 'antd/es/date-picker';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { monoStil, useRollen } from '../components/instrument';
import { serverJetzt } from '../offline/serveruhr';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { browserZone, effektiveZone, istZukunftstag, ausWanduhr, zuWanduhr } from './zeitEingabe';

/** Kanonischer Name einer Zone (Aliasse wie `Etc/UTC` → `UTC`), damit der Hinweis nicht flackert. */
function kanonisch(zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
}

export interface ZeitEingabeKontext {
  /** Effektive Anzeigezone; `null` = Browserzone. */
  zone: string | null;
  /** Zu nennende Zone, wenn sie von der Browserzone abweicht, sonst `null`. */
  zonenHinweis: string | null;
  /** Zeitpunkt → Picker-Wert (browserlokal, Wanduhr der Anzeigezone). */
  zuPicker: (zeitpunkt: Dayjs) => Dayjs;
  /** Picker-Wert → Zeitpunkt. */
  ausPicker: (wanduhr: Dayjs) => Dayjs;
  /** Zeitpunkt als Text in der Anzeigezone (für Chips, Titel, Stand-Zeiten). */
  formatiere: (zeitpunkt: Dayjs, format: string) => string;
  /** `disabledDate` für Eingaben ohne Zukunftstage — Kalendertag der Anzeigezone. */
  istZukunftstag: (wanduhr: Dayjs) => boolean;
}

/** Zone und Wandlung der aktuellen Anzeige-Konventionen. */
export function useZeitEingabe(): ZeitEingabeKontext {
  const { konventionen } = useAnzeigeKonventionen();
  const zone = effektiveZone(konventionen.zeitzone);
  const zonenHinweis = zone && kanonisch(zone) !== kanonisch(browserZone()) ? zone : null;
  return useMemo(
    () => ({
      zone,
      zonenHinweis,
      zuPicker: (d) => zuWanduhr(d, zone),
      ausPicker: (w) => ausWanduhr(w, zone),
      formatiere: (d, format) => zuWanduhr(d, zone).format(format),
      istZukunftstag: (w) => istZukunftstag(w, zone),
    }),
    [zone, zonenHinweis],
  );
}

function ZonenText({ zone }: { zone: string }) {
  const { rollen } = useRollen();
  return <span style={{ ...monoStil(11), color: rollen.gedaempft }}>{zone}</span>;
}

function PanelFuss({ zone, onJetzt }: { zone: string | null; onJetzt?: () => void }) {
  const { rollen } = useRollen();
  if (!zone && !onJetzt) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '4px 0',
      }}
    >
      {zone ? (
        <span style={{ color: rollen.gedaempft }}>
          Zeiten in <span style={monoStil(12)}>{zone}</span>
        </span>
      ) : (
        <span />
      )}
      {onJetzt && (
        <Button type="link" onClick={onJetzt}>
          Jetzt
        </Button>
      )}
    </div>
  );
}

/**
 * Picker-Wert mit STABILER Identität: ein neues Objekt nur bei einem anderen Zeitpunkt (Review
 * LFH-692). rc-picker setzt Kalender- und Übernahmewert zurück, sobald `value` die Identität
 * wechselt — ein Re-Render bei offenem Panel (Verpflegung: alle 30 s) verwürfe sonst eine noch
 * nicht bestätigte Wahl. Primitive als Schlüssel, damit `exhaustive-deps` ohne Ausnahme trägt.
 */
function usePickerWert(
  zeitpunkt: Dayjs | null | undefined,
  zuPicker: (d: Dayjs) => Dayjs,
): Dayjs | null | undefined {
  const ms = zeitpunkt ? zeitpunkt.valueOf() : null;
  const leer = zeitpunkt === null ? null : undefined;
  return useMemo(() => (ms == null ? leer : zuPicker(dayjs(ms))), [ms, leer, zuPicker]);
}

type EinzelBasis = Omit<
  ComponentProps<typeof DatePicker>,
  | 'value'
  | 'defaultValue'
  | 'onChange'
  | 'onOk'
  | 'showNow'
  | 'disabledDate'
  | 'renderExtraFooter'
  | 'prefix'
  | 'ref'
  | 'multiple'
>;

/** antds Einzelpicker typisiert auch den Mehrfachmodus; den bietet der Baustein nicht an. */
function einzeln(d: Dayjs | Dayjs[] | null): Dayjs | null {
  return Array.isArray(d) ? (d[0] ?? null) : d;
}

export interface ZeitpunktEingabeProps extends EinzelBasis {
  value?: Dayjs | null;
  defaultValue?: Dayjs | null;
  onChange?: (zeitpunkt: Dayjs | null) => void;
  onOk?: (zeitpunkt: Dayjs | null) => void;
  /** Tage nach „heute“ (Kalender der Anzeigezone) sind nicht wählbar. */
  keineZukunftstage?: boolean;
  ref?: Ref<GetRef<typeof DatePicker>>;
}

/** Ein Zeitpunkt (Datum + Uhrzeit) in der Anzeigezone. */
export function ZeitpunktEingabe(props: ZeitpunktEingabeProps) {
  const {
    value,
    defaultValue,
    onChange,
    onOk,
    keineZukunftstage,
    showTime,
    open,
    onOpenChange,
    ...rest
  } = props;
  const z = useZeitEingabe();
  // Form.Item reicht `value` immer durch, auch als `undefined` — der Schlüssel entscheidet.
  const gesteuert = Object.prototype.hasOwnProperty.call(props, 'value');
  const [intern, setIntern] = useState<Dayjs | null | undefined>(defaultValue);
  const zeitpunkt = gesteuert ? value : intern;
  const [offenIntern, setOffenIntern] = useState(false);

  const pickerWert = usePickerWert(zeitpunkt, z.zuPicker);

  const melde = (neu: Dayjs | null) => {
    if (!gesteuert) setIntern(neu);
    onChange?.(neu);
  };
  const oeffne = (o: boolean) => {
    setOffenIntern(o);
    onOpenChange?.(o);
  };

  return (
    <DatePicker
      {...rest}
      showTime={showTime ?? true}
      showNow={false}
      open={open ?? offenIntern}
      onOpenChange={oeffne}
      value={pickerWert}
      onChange={(d) => {
        const w = einzeln(d);
        melde(w ? z.ausPicker(w) : null);
      }}
      onOk={(d) => {
        const w = einzeln(d);
        onOk?.(w ? z.ausPicker(w) : null);
      }}
      disabledDate={keineZukunftstage ? z.istZukunftstag : undefined}
      prefix={z.zonenHinweis ? <ZonenText zone={z.zonenHinweis} /> : undefined}
      renderExtraFooter={() => (
        <PanelFuss
          zone={z.zonenHinweis}
          onJetzt={() => {
            const jetzt = serverJetzt();
            melde(jetzt);
            onOk?.(jetzt);
            oeffne(false);
          }}
        />
      )}
    />
  );
}

export type Zeitraum = [Dayjs | null, Dayjs | null];

type BereichBasis = Omit<
  RangePickerProps,
  'value' | 'defaultValue' | 'onChange' | 'renderExtraFooter' | 'prefix' | 'disabledDate'
>;

export interface ZeitraumEingabeProps extends BereichBasis {
  value?: Zeitraum | null;
  onChange?: (zeitraum: Zeitraum | null) => void;
}

/** Ein Zeitraum (Beginn und Ende, je Datum + Uhrzeit) in der Anzeigezone. */
export function ZeitraumEingabe({ value, onChange, showTime, ...rest }: ZeitraumEingabeProps) {
  const z = useZeitEingabe();
  const von = usePickerWert(value?.[0], z.zuPicker);
  const bis = usePickerWert(value?.[1], z.zuPicker);
  // `null` (geleert) bleibt `null`, sonst hielte antd das Feld für ungesteuert.
  const leer = value === null ? null : value === undefined ? undefined : 'gesetzt';
  const pickerWert = useMemo<Zeitraum | null | undefined>(
    () => (leer === 'gesetzt' ? [von ?? null, bis ?? null] : leer),
    [leer, von, bis],
  );
  const hinweis: ReactNode = z.zonenHinweis ? <ZonenText zone={z.zonenHinweis} /> : undefined;
  return (
    <DatePicker.RangePicker
      {...rest}
      showTime={showTime ?? true}
      value={pickerWert}
      onChange={(d) =>
        onChange?.(d ? [d[0] ? z.ausPicker(d[0]) : null, d[1] ? z.ausPicker(d[1]) : null] : null)
      }
      prefix={hinweis}
      renderExtraFooter={z.zonenHinweis ? () => <PanelFuss zone={z.zonenHinweis} /> : undefined}
    />
  );
}
