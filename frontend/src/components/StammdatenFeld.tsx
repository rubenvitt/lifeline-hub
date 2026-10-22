import { App, AutoComplete, Button, Tag } from 'antd';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { DEMO_GROUP, DemoLabel } from '../stammdaten/demoAuswahl';
import { FeldFehler, useRollen } from './instrument';
import {
  baueVorschlagsliste,
  exakterTreffer,
  herkunftDesWerts,
  HERKUNFT_WORT,
  type Herkunft,
  type StammdatenWert,
  type Vorschlag,
  type Vorschlagsquelle,
} from './stammdatenFeldKern';

export type {
  StammdatenRef,
  StammdatenUebernahme,
  StammdatenWert,
  Vorschlag,
  Vorschlagsquelle,
} from './stammdatenFeldKern';

/** Der Ref des Eingabefelds (antds `AutoComplete`), etwa für `focus({ preventScroll })`. */
type FeldRef = Ref<ComponentRef<typeof AutoComplete>>;

interface BasisProps {
  /** Die Adapter aus `stammdaten/vorschlagsquellen.ts`; das Feld kennt keine einzelne Quelle. */
  quellen: readonly Vorschlagsquelle[];
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  /** Grenze des Servers (LFH-937): natives `maxLength`, einzeilig. */
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Stil der Hülle (Feld, Marke, Knopf in einer Zeile). */
  style?: CSSProperties;
  /** Stil des Eingabefelds; Vorgabe: es füllt die Zeile. */
  feldStil?: CSSProperties;
  ref?: FeldRef;
  /** Ein Vorschlag ist gewählt (Klick, oder Enter auf dem markierten). */
  onWahl?: (vorschlag: Vorschlag) => void;
  /**
   * Enter hat den getippten Text übernommen (Liste zu, oder offen ohne Markierung). Bei offener
   * Liste sendet das Feld das Formular nie mit (design.md D3).
   */
  onEnter?: (text: string) => void;
  /** Escape bei geschlossener Liste; bei offener schließt Escape nur die Liste. */
  onEscape?: () => void;
}

type WertProps =
  | { nurText: true; value?: string; onChange?: (wert: string) => void }
  | { nurText?: false; value?: StammdatenWert; onChange?: (wert: StammdatenWert) => void };

export type StammdatenFeldProps = BasisProps & WertProps;

const LEER: StammdatenWert = { text: '' };

/**
 * StammdatenFeld — Vorschlagsfeld „aus Stammdaten oder frei“ (LLH-1144, Spec `stammdaten-feld`,
 * Regel `frontend/AGENTS.md`, Erfassungs-Norm; Herleitung
 * `/mnt/project-files/llh-1022/LLH-1144/design.md`).
 *
 * Tippen filtert die Vorschläge der Quellen in den Gruppen „Im Einsatz“, „Stammdaten“, „Zuletzt
 * verwendet“, Demo-Einträge dahinter (`stammdaten/demoAuswahl.tsx`). Freitext bleibt erlaubt und
 * trägt die Marke „frei“, ein gewählter Wert die Herkunft; beides als Wort, die Eingabe verweist
 * per `aria-describedby` darauf. Neben einem freien Wert steht „In Stammdaten übernehmen“, wenn
 * eine Quelle einen Katalog zum Anlegen mitbringt; ohne Recht gesperrt mit Grund daneben.
 *
 * Wertform (D1): `{ text, ref? }`, im Modus `nurText` der reine Text (die Marke leitet sich dann
 * aus dem Treffer ab).
 *
 * Tastatur (D3): ↓ öffnet, Enter übernimmt den markierten Vorschlag, sonst den Freitext, Escape
 * schließt. Enter bei offener Liste sendet nie; bei geschlossener gilt die Erfassungs-Norm. Enter
 * öffnet die Liste nicht (rc-select täte es, `BaseSelect` `onInternalKeyDown`).
 *
 * Trefflächen (D6): die Zeilen sind antds Optionen mit `optionHeight = controlHeight`, also
 * 30/48/72 px je Dichte; kein `size`, kein eigenes Maß.
 */
export default function StammdatenFeld(props: StammdatenFeldProps) {
  const {
    quellen,
    id,
    maxLength,
    placeholder,
    disabled = false,
    style,
    feldStil,
    ref,
    onWahl,
    onEnter,
    onEscape,
  } = props;
  const { token } = useRollen();
  const { message } = App.useApp();
  const markeId = useId();
  const grundId = useId();
  const fehlerId = useId();

  const wert: StammdatenWert = props.nurText ? { text: props.value ?? '' } : (props.value ?? LEER);
  const text = wert.text;

  const setze = (neu: StammdatenWert) => {
    if (props.nurText) props.onChange?.(neu.text);
    else props.onChange?.(neu);
  };

  const [offen, setOffen] = useState(false);
  /** Der markierte Vorschlag (rc-select `onActive`); `null` heißt: Enter nimmt den Freitext. */
  const aktivRef = useRef<string | null>(null);
  /** Läuft gerade ein Enter? Dann bleibt die Liste zu (s. Dateikopf). */
  const enterRef = useRef(false);
  /** Wurde in der offenen Liste mit ↓/↑ markiert? Nur dann nimmt Enter den Vorschlag. */
  const pfeilRef = useRef(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  /** Gerade angelegt, die Quelle hat es aber noch nicht neu geladen. */
  const [angelegt, setAngelegt] = useState<string | null>(null);

  const liste = useMemo(() => baueVorschlagsliste(quellen, text), [quellen, text]);
  const optionen = useMemo(
    () => [
      ...liste.gruppen.map((g) => ({
        label: g.titel,
        title: g.titel,
        options: g.eintraege.map((v) => ({ value: v.wert, label: v.label, title: v.label })),
      })),
      ...(liste.demo.length > 0
        ? [
            {
              label: DEMO_GROUP,
              title: DEMO_GROUP,
              options: liste.demo.map((v) => ({
                value: v.wert,
                label: <DemoLabel>{v.label}</DemoLabel>,
                title: v.label,
              })),
            },
          ]
        : []),
    ],
    [liste],
  );
  const nachWert = useMemo(() => {
    const karte = new Map<string, Vorschlag>();
    for (const v of [...liste.gruppen.flatMap((g) => g.eintraege), ...liste.demo]) {
      karte.set(v.wert, v);
    }
    return karte;
  }, [liste]);

  const listeOffen = offen && optionen.length > 0;

  const oeffne = (auf: boolean) => {
    if (auf && enterRef.current) return;
    if (!auf) {
      aktivRef.current = null;
      pfeilRef.current = false;
    }
    setOffen(auf);
  };

  // Ohne jede Quelle ist alles frei; die Marke sagte dann nichts.
  const herkunft: Herkunft | null =
    quellen.length === 0
      ? null
      : angelegt != null && angelegt === text.trim()
        ? 'stammdaten'
        : herkunftDesWerts(wert, quellen);
  const uebernahmeQuelle = quellen.find((q) => q.uebernahme);
  const uebernahme = uebernahmeQuelle?.uebernahme;
  const zuLang = uebernahme?.maxLaenge != null && text.trim().length > uebernahme.maxLaenge;
  const sperrGrund = uebernahme?.gesperrt ?? (zuLang ? 'zu lang' : null);
  const zeigeUebernahme = herkunft === 'frei' && uebernahme != null;

  function waehle(v: Vorschlag) {
    setFehler(null);
    setze({ text: v.wert, ...(v.ref ? { ref: v.ref } : {}) });
    oeffne(false);
    onWahl?.(v);
  }

  function nimmFreitext() {
    // Ein exakter Treffer ist kein freier Wert: er bekommt seine Referenz (Modus mit `ref`).
    const treffer = exakterTreffer(text, quellen);
    if (treffer?.ref && !wert.ref) setze({ text, ref: treffer.ref });
    onEnter?.(text);
  }

  function beiTasteVorab(e: KeyboardEvent<HTMLElement>) {
    // Nur Tasten im Eingabefeld; der Knopf daneben bedient sich selbst.
    if ((e.target as HTMLElement).getAttribute('role') !== 'combobox') return;
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      // Mit ↓/↑ markiert: rc-select wählt den Vorschlag und verhindert das Absenden selbst. Die
      // Markierung, die rc-select beim Tippen auf einen Präfix-Treffer setzt (`OptionList`, „Auto
      // scroll“), zählt nicht: Enter nach dem Tippen nimmt den getippten Text (D3).
      if (listeOffen && pfeilRef.current && aktivRef.current != null) return;
      enterRef.current = true;
      if (listeOffen) {
        e.preventDefault();
        e.stopPropagation();
        oeffne(false);
      }
      nimmFreitext();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (listeOffen) pfeilRef.current = true;
      else if (e.key === 'ArrowDown' && optionen.length > 0) setOffen(true);
      return;
    }
    if (e.key === 'Escape') {
      if (listeOffen) {
        // Selbst schließen: rc-select schlösse erst nach einer Makroaufgabe, und ein Dialog
        // darüber bekäme das Escape mit.
        e.stopPropagation();
        oeffne(false);
      } else {
        onEscape?.();
      }
    }
  }

  async function uebernehmen() {
    if (!uebernahme || !uebernahmeQuelle || sperrGrund || laeuft) return;
    const neu = text.trim();
    setLaeuft(true);
    setFehler(null);
    try {
      const angelegterSatz = await uebernahme.anlegen(neu);
      setAngelegt(neu);
      setze({ text: neu, ref: { quelle: uebernahmeQuelle.id, id: angelegterSatz.id } });
      void message.success(`„${neu}“ in ${uebernahme.ziel} übernommen`);
    } catch (err) {
      setFehler(
        `Nicht übernommen: ${err instanceof Error && err.message ? err.message : 'unbekannter Fehler'}`,
      );
    } finally {
      setLaeuft(false);
    }
  }

  const beschreibung =
    [props['aria-describedby'], herkunft ? markeId : null, fehler ? fehlerId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <span
      data-lfh="stammdatenfeld"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: token.marginXS,
        minWidth: 0,
        ...style,
      }}
      onKeyDownCapture={beiTasteVorab}
      onKeyDown={() => {
        // Nach rc-selects eigenem Handler: das Enter ist durch, die Liste darf wieder aufgehen.
        enterRef.current = false;
      }}
      onKeyUp={() => {
        enterRef.current = false;
      }}
    >
      <AutoComplete
        ref={ref}
        id={id}
        aria-label={props['aria-label']}
        aria-describedby={beschreibung}
        aria-invalid={fehler ? true : undefined}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        style={{ flex: '1 1 10em', minWidth: 0, ...feldStil }}
        value={text}
        options={optionen}
        open={listeOffen}
        onOpenChange={oeffne}
        defaultActiveFirstOption={false}
        onActive={(v) => {
          aktivRef.current = v == null ? null : String(v);
        }}
        onSearch={(eingabe) => {
          setFehler(null);
          pfeilRef.current = false;
          setze({ text: eingabe });
          if (eingabe && !enterRef.current) setOffen(true);
        }}
        onSelect={(v) => {
          const vorschlag = nachWert.get(String(v));
          if (vorschlag) waehle(vorschlag);
        }}
      />
      {herkunft && (
        <Tag
          id={markeId}
          data-lfh="quellenmarke"
          data-herkunft={herkunft}
          style={{ marginInlineEnd: 0 }}
        >
          {HERKUNFT_WORT[herkunft]}
        </Tag>
      )}
      {zeigeUebernahme && (
        <>
          <Button
            disabled={disabled || sperrGrund != null}
            loading={laeuft}
            aria-describedby={sperrGrund ? grundId : undefined}
            onClick={() => void uebernehmen()}
          >
            In Stammdaten übernehmen
          </Button>
          {sperrGrund && (
            <span id={grundId} data-lfh="uebernahme-grund">
              {sperrGrund}
            </span>
          )}
        </>
      )}
      {fehler && (
        <span style={{ flexBasis: '100%' }}>
          <FeldFehler id={fehlerId}>{fehler}</FeldFehler>
        </span>
      )}
    </span>
  );
}
