/**
 * Zeiteingabe in der Anzeigezone (LFH-692, Fähigkeit `zeiteingabe`; Regel: `frontend/AGENTS.md`,
 * „Zeiteingabe in der Anzeigezone“). Jede Zeiteingabe der Oberfläche läuft über diese Bausteine
 * (Guard `zeitEingabe.guard.test.ts`).
 *
 * Textfeld zuerst (`openspec/changes/ri685cfi-zeiteingabe-tippen-schnellwahl/design.md`, D1–D8):
 * - Getippt wird taktisch („1430“, „101430“, „101430okt26“), deutsch, ISO oder relativ („-5“,
 *   „+2h“, „j“); die eine Deutung ist `zeitParser.ts`. Das Feld zeigt seinen Wert als DTG
 *   („161430okt26“, Entscheidung E1), beim Tippen daneben die Deutung oder den Grund.
 * - Enter übernimmt (und das Formular sendet wie gewohnt), Verlassen übernimmt eine lesbare
 *   Eingabe, Escape verwirft. Unlesbares wird nie übernommen und nie still korrigiert: Enter sendet
 *   dann nicht, Verlassen zeigt wieder den geltenden Wert und nennt den Grund (D3).
 * - `value`/`onChange` tauschen ABSOLUTE Zeitpunkte; `onChange` feuert nur bei einem anderen
 *   Zeitpunkt, ein unberührtes Feld behält den gelesenen (Spec: „Unverändertes Speichern
 *   verschiebt nichts“).
 * - „Jetzt“, relative Eingaben und die Schnellwahl messen an der Serveruhr (LFH-895).
 * - Weicht die Anzeigezone von der Browserzone ab, steht die Zone am Feld und im Kalender.
 * - Der Kalender ist ein Nebenweg ({@link ZeitKalender}); passt er nicht sicher neben das Feld,
 *   steht er als Blatt am unteren Rand (LFH-953, LFH-1076, {@link zeitPanelAmFeldAb}).
 */
import { Button, Input, Popover, Space, theme, type InputRef } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  type Ref,
} from 'react';
import { monoStil, useRollen } from '../components/instrument';
import { useViewport, type AbBreitePunkt } from '../components/useViewport';
import { IconKalender } from '../icons';
import { serverJetzt } from '../offline/serveruhr';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { formatDtg } from './format';
import { ZeitKalender } from './ZeitKalender';
import { ZeitSchnellwahlKnoepfe } from './ZeitSchnellwahlKnoepfe';
import { deuteZeit, type Deutung, type ZeitArt } from './zeitParser';
import { browserZone, effektiveZone, istZukunftstag, zuWanduhr } from './zeitEingabe';
import './ZeitpunktEingabe.css';

export type { ZeitArt } from './zeitParser';

/** Kanonischer Name einer Zone (Aliasse wie `Etc/UTC` → `UTC`), damit der Hinweis nicht flackert. */
function kanonisch(zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
}

export interface ZeitEingabeKontext {
  /** Effektive Anzeigezone; `null` = Browserzone. */
  zone: string | null;
  /** Zu nennende Zone, wenn sie von der Browserzone abweicht, sonst `null`. */
  zonenHinweis: string | null;
  /** Zeitpunkt als Text in der Anzeigezone (für Chips, Titel, Stand-Zeiten). */
  formatiere: (zeitpunkt: Dayjs, format: string) => string;
  /** Liegt der Kalendertag einer Wanduhr nach „heute“ der Anzeigezone? */
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
      formatiere: (d, format) => zuWanduhr(d, zone).format(format),
      istZukunftstag: (w) => istZukunftstag(w, zone),
    }),
    [zone, zonenHinweis],
  );
}

/** Klasse des Blatts; die Regeln stehen in `ZeitpunktEingabe.css`. */
export const ZEIT_BLATT = 'lfh-zeit-blatt';

/**
 * Ab welcher Breite der Kalender sicher neben dem Feld steht, je Stufe (LFH-1076); `null`: nie.
 * Gemessen wurde das alte Panel (Kalender und Uhrzeit nebeneinander: 437 / 797 / 1191 px); der
 * Kalender ist schmaler, die Schwellen bleiben als sichere Seite. Popover kippen nur zur anderen
 * Feldkante, sie schieben nicht. Die Stufe kommt aus dem Token, nicht aus `useDichte()`, damit
 * Kalender und Weiche unter einem lokalen Theme nicht auseinanderlaufen; abgeleitet wird sie nie
 * aus Einsatz oder Rolle (`frontend/AGENTS.md`, „Die Stufe folgt dem Gerät“).
 */
export function zeitPanelAmFeldAb(token: { controlHeight: number }): AbBreitePunkt | null {
  if (token.controlHeight >= 72) return null;
  if (token.controlHeight >= 48) return 'xxl';
  return 'md';
}

/**
 * Lage des Kalenders: Blatt oder am Feld, dort mit fester Breite. Zehn Steuerhöhen tragen sieben
 * Tagesspalten samt Rand (kompakt 320 px, komfortabel 500 px; `handschuh` steht nie am Feld).
 */
function useKalenderLage(): {
  istBlatt: boolean;
  istBeruehrung: boolean;
  breiteAmFeld: number;
} {
  const { abBreite, istBeruehrung } = useViewport();
  const { token } = theme.useToken();
  const ab = zeitPanelAmFeldAb(token);
  return {
    istBlatt: ab === null || !abBreite(ab),
    istBeruehrung,
    breiteAmFeld: token.controlHeight * 10 + 20,
  };
}

/** Gleicher Zeitpunkt (am Instant) oder beide leer. */
function gleich(a: Dayjs | null | undefined, b: Dayjs | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.valueOf() === b.valueOf();
}

/** Anzeige eines Tages ohne Uhrzeit (`nurTag`): keine DTG, ein Tag ist kein Zeitpunkt. */
function formatTag(zeitpunkt: Dayjs, zone: string | null): string {
  return zuWanduhr(zeitpunkt, zone).format('DD.MM.YYYY');
}

export interface ZeitpunktEingabeProps {
  value?: Dayjs | null;
  defaultValue?: Dayjs | null;
  onChange?: (zeitpunkt: Dayjs | null) => void;
  /** Ausdrücklich übernommen: Enter, Schnellwahl oder „Übernehmen“ im Kalender (nicht Verlassen). */
  onOk?: (zeitpunkt: Dayjs | null) => void;
  /** Ereignis (Vergangenheit) oder Frist (Zukunft): wohin eine Uhrzeit ohne Tag fällt. */
  art?: ZeitArt;
  /** Tage nach „heute“ (Kalender der Anzeigezone) sind nicht wählbar; ohne `art` = Ereignis. */
  keineZukunftstage?: boolean;
  /** Schnellwahl der Feldart zusätzlich als Knopfreihe unter dem Feld (sonst nur im Kalender). */
  schnellwahl?: boolean;
  /** Nur ein Kalendertag, keine Uhrzeit (Anzeige `TT.MM.JJJJ`). */
  nurTag?: boolean;
  /** Eine bloße Uhrzeit liegt am Tag dieses Zeitpunkts und danach (Ende eines Zeitraums). */
  bezug?: Dayjs | null;
  /** `false`: Leeren ist keine gültige Eingabe. */
  allowClear?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  /** `Form.Item` meldet einen Prüffehler darüber; ein eigener Grund des Felds geht vor. */
  'aria-invalid'?: boolean | 'true' | 'false';
  autoFocus?: boolean;
  style?: CSSProperties;
  className?: string;
  status?: 'error' | 'warning';
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  /** Kalender offen (gesteuert); `onOpenChange` meldet ihn (`InlineAngabe` unterscheidet Escape). */
  open?: boolean;
  onOpenChange?: (offen: boolean) => void;
  ref?: Ref<InputRef>;
  [daten: `data-${string}`]: string | number | undefined;
}

/** Ein Zeitpunkt (Datum + Uhrzeit) in der Anzeigezone. */
export function ZeitpunktEingabe(props: ZeitpunktEingabeProps) {
  const {
    value,
    defaultValue,
    onChange,
    onOk,
    art,
    keineZukunftstage,
    schnellwahl,
    nurTag,
    bezug,
    allowClear,
    disabled,
    placeholder,
    id,
    autoFocus,
    style,
    className,
    status,
    onKeyDown,
    onFocus,
    onBlur,
    open,
    onOpenChange,
    ref,
    'aria-label': ariaLabel,
    'aria-describedby': beschriebenVon,
    'aria-invalid': ariaInvalid,
    ...daten
  } = props;
  const z = useZeitEingabe();
  const { rollen } = useRollen();
  const { istBlatt, istBeruehrung, breiteAmFeld } = useKalenderLage();
  // Form.Item reicht `value` immer durch, auch als `undefined` — der Schlüssel entscheidet.
  const gesteuert = Object.prototype.hasOwnProperty.call(props, 'value');
  const [intern, setIntern] = useState<Dayjs | null | undefined>(defaultValue);
  const wert = gesteuert ? value : intern;
  /** Getippter Text; `null` = es wird nicht getippt, das Feld zeigt den Wert. */
  const [text, setText] = useState<string | null>(null);
  /** Grund einer verworfenen Eingabe, bis erneut getippt wird. */
  const [verworfen, setVerworfen] = useState<string | null>(null);
  const [offenIntern, setOffenIntern] = useState(false);
  const offen = open ?? offenIntern;
  const hinweisId = useId();
  /** Name des Felds für den Kalender-Knopf: mehrere Zeitfelder stehen oft nebeneinander. */
  const feldName = ariaLabel;
  const feldRef = useRef<InputRef | null>(null);
  // Die Ref des Aufrufers bekommt das Feld EINMAL je Einhängen: antds `Input` erneuert sein Handle
  // bei jedem Rendern (`useImperativeHandle` ohne Abhängigkeiten, React ruft die Ref dabei mit
  // `null` und dem neuen Handle), und eine fokussierende Ref wie die des ETB-Chips
  // (`etb/MetaChip.tsx`, `fokusOhneRollen`) holte sich sonst nach jedem Blur den Fokus zurück.
  useLayoutEffect(() => {
    if (!ref) return;
    const setze = (el: InputRef | null) => {
      if (typeof ref === 'function') ref(el);
      else (ref as RefObject<InputRef | null>).current = el;
    };
    setze(feldRef.current);
    return () => setze(null);
  }, [ref]);
  /**
   * Nach dem Kalender zurück ins Feld, sonst stünde der Fokus auf `<body>`. Nicht bei
   * Fingerbedienung: dort ginge die Bildschirmtastatur auf.
   */
  function zurueckInsFeld() {
    if (!istBeruehrung) feldRef.current?.focus({ preventScroll: true });
  }

  const anzeige = wert ? (nurTag ? formatTag(wert, z.zone) : formatDtg(wert, z.zone)) : '';
  const deutung: Deutung | null =
    text === null || text === anzeige
      ? null
      : deuteZeit(text, {
          zone: z.zone,
          jetzt: serverJetzt(),
          art,
          keineZukunftstage,
          bezug,
          nurTag,
        });
  const leerVerboten = deutung?.ok && deutung.zeitpunkt === null && allowClear === false;
  const grund = deutung && !deutung.ok ? deutung.grund : leerVerboten ? 'Angabe fehlt' : verworfen;

  function melde(neu: Dayjs | null) {
    if (gleich(neu, wert)) return;
    if (!gesteuert) setIntern(neu);
    onChange?.(neu);
  }

  /** Den getippten Text übernehmen; `false`, wenn er nicht lesbar ist. */
  function uebernimmText(): Dayjs | null | false {
    if (!deutung) {
      setText(null);
      return wert ?? null;
    }
    if (!deutung.ok || leerVerboten) return false;
    melde(deutung.zeitpunkt);
    setText(null);
    setVerworfen(null);
    return deutung.zeitpunkt;
  }

  function oeffne(o: boolean) {
    setOffenIntern(o);
    onOpenChange?.(o);
  }

  function ausWahl(neu: Dayjs) {
    melde(neu);
    setText(null);
    setVerworfen(null);
    onOk?.(neu);
  }

  const hinweisText = grund
    ? grund
    : deutung?.ok && deutung.zeitpunkt
      ? `= ${nurTag ? formatTag(deutung.zeitpunkt, z.zone) : formatDtg(deutung.zeitpunkt, z.zone)}${
          deutung.hinweis ? ` · ${deutung.hinweis}` : ''
        }`
      : '';
  // Das Suffix steht IMMER im DOM: antds `Input` baut sein Gerüst um, sobald ein Suffix kommt oder
  // geht, und das Feld verlöre mitten im Tippen den Fokus.
  const suffix = (
    <span
      id={hinweisId}
      aria-live="polite"
      style={{
        ...(grund ? {} : monoStil(12)),
        color: grund ? rollen.alarmText : rollen.gedaempft,
      }}
    >
      {hinweisText}
    </span>
  );

  const beschreibung = [beschriebenVon, hinweisText ? hinweisId : undefined]
    .filter(Boolean)
    .join(' ');

  const kalender = (
    <ZeitKalender
      wert={wert}
      zone={z.zone}
      zonenHinweis={z.zonenHinweis}
      jetzt={serverJetzt}
      art={art}
      keineZukunftstage={keineZukunftstage}
      nurTag={nurTag}
      fokusUhrzeit={!istBeruehrung}
      breite={istBlatt ? undefined : breiteAmFeld}
      onUebernehmen={(neu) => {
        ausWahl(neu);
        oeffne(false);
        zurueckInsFeld();
      }}
      onAbbrechen={() => {
        oeffne(false);
        zurueckInsFeld();
      }}
    />
  );

  const feld = (
    <Space.Compact block={style?.width === '100%'} style={style} className={className}>
      <Input
        {...daten}
        ref={feldRef}
        id={id}
        aria-label={ariaLabel}
        aria-describedby={beschreibung || undefined}
        aria-invalid={grund ? true : ariaInvalid}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        status={grund ? 'error' : status}
        value={text ?? anzeige}
        prefix={
          z.zonenHinweis ? (
            <span style={{ ...monoStil(11), color: rollen.gedaempft }}>{z.zonenHinweis}</span>
          ) : undefined
        }
        suffix={suffix}
        style={{ ...monoStil(14) }}
        onFocus={(e) => {
          e.target.select();
          onFocus?.(e);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setVerworfen(null);
        }}
        onKeyDown={(e) => {
          const speichern = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
          if (e.key === 'Enter') {
            const neu = uebernimmText();
            if (neu === false) e.preventDefault();
            else onOk?.(neu);
          } else if (speichern && text !== null) {
            // Strg/⌘+S speichert ohne Verlassen des Felds (`command-palette/befehle.ts`); die
            // getippte Zeit gilt dann wie bei Enter, eine unlesbare sperrt das Speichern.
            if (uebernimmText() === false) e.preventDefault();
          } else if (e.key === 'Escape' && text !== null) {
            // Nur die Eingabe zurück, nicht den ganzen Dialog (Spec „Escape verwirft“): die
            // Tastaturebene der App liest `defaultPrevented`. `InlineAngabe` schließt die Zeile
            // weiter, wie es Escape dort immer tut.
            e.preventDefault();
            setText(null);
            setVerworfen(null);
          }
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          if (text !== null && uebernimmText() === false) {
            setVerworfen(grund);
            setText(null);
          }
          onBlur?.(e);
        }}
      />
      <Popover
        open={offen && !disabled}
        onOpenChange={oeffne}
        trigger="click"
        placement="bottomRight"
        arrow={false}
        destroyOnHidden
        classNames={istBlatt ? { root: ZEIT_BLATT } : undefined}
        content={kalender}
      >
        <Button
          aria-label={`${nurTag ? 'Kalender' : 'Kalender und Uhrzeit'}${
            feldName ? ` zu ${feldName}` : ''
          }`}
          aria-haspopup="dialog"
          aria-expanded={offen}
          disabled={disabled}
          icon={<IconKalender />}
        />
      </Popover>
    </Space.Compact>
  );

  if (!schnellwahl) return feld;
  return (
    <Space direction="vertical" size="small" style={{ width: style?.width }}>
      {feld}
      <ZeitSchnellwahlKnoepfe art={art} disabled={disabled} onWahl={ausWahl} />
    </Space>
  );
}

export type Zeitraum = [Dayjs | null, Dayjs | null];

export interface ZeitraumEingabeProps extends Pick<
  ZeitpunktEingabeProps,
  'art' | 'disabled' | 'allowClear' | 'id' | 'style' | 'className' | 'status'
> {
  value?: Zeitraum | null;
  onChange?: (zeitraum: Zeitraum | null) => void;
  /** Namen der beiden Felder; Vorgabe „Beginn“ und „Ende“. */
  placeholder?: [string, string];
  [daten: `data-${string}`]: string | number | undefined;
}

/**
 * Ein Zeitraum aus zwei Zeitfeldern (D7). Ein Ende ohne Tag liegt am Tag des Beginns, sonst am
 * Folgetag (Spec `zeiteingabe`, „Ende eines Zeitraums ohne Tag“). Der Wert bleibt das Tupel.
 */
export function ZeitraumEingabe({
  value,
  onChange,
  placeholder = ['Beginn', 'Ende'],
  id,
  style,
  className,
  ...rest
}: ZeitraumEingabeProps) {
  const [von, bis] = value ?? [null, null];
  const endeRef = useRef<InputRef | null>(null);
  // Halbe Tupel bleiben stehen, damit das andere Ende beim Tippen nicht verloren geht; die
  // Pflichtprüfung des Aufrufers verlangt beide Enden (`verpflegung/VerpflegungDialoge.tsx`).
  const melde = (neu: Zeitraum) => onChange?.(neu[0] || neu[1] ? neu : null);
  return (
    <div
      id={id ? `${id}-zeitraum` : undefined}
      className={className}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, ...style }}
    >
      <div style={{ flex: '1 1 14ch', minWidth: 0 }}>
        <ZeitpunktEingabe
          {...rest}
          id={id}
          aria-label={placeholder[0]}
          placeholder={placeholder[0]}
          style={{ width: '100%' }}
          value={von ?? null}
          onChange={(d) => melde([d, bis ?? null])}
          onKeyDown={(e) => {
            // Enter im Beginn führt ins leere Ende, statt das Formular halb abzusenden.
            if (e.key === 'Enter' && !e.defaultPrevented && !bis) {
              e.preventDefault();
              endeRef.current?.focus();
            }
          }}
        />
      </div>
      <div style={{ flex: '1 1 14ch', minWidth: 0 }}>
        <ZeitpunktEingabe
          {...rest}
          ref={endeRef}
          aria-label={placeholder[1]}
          placeholder={placeholder[1]}
          style={{ width: '100%' }}
          bezug={von ?? null}
          value={bis ?? null}
          onChange={(d) => melde([von ?? null, d])}
        />
      </div>
    </div>
  );
}
