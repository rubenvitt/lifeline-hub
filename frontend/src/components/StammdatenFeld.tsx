import { App, AutoComplete, Button, Tag } from 'antd';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
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

/** Wie ein Wert übernommen wurde: Enter, Tab oder Klick auf einen Listeneintrag. */
export type UebernahmeWeg = 'enter' | 'tab' | 'klick';

/**
 * Eine Übernahme (`onUebernahme`): der Text, der jetzt im Feld steht, und der Vorschlag, wenn
 * einer gewählt ist; ohne `vorschlag` ist es der getippte Text (Freitext-Eintrag, oder Enter bei
 * geschlossener Liste).
 */
export interface StammdatenFeldUebernahme {
  text: string;
  vorschlag?: Vorschlag;
  weg: UebernahmeWeg;
  /**
   * Ein Eintrag der offenen Liste (Vorschlag oder Freitext-Eintrag); `false` heißt Enter bei
   * geschlossener Liste, der Moment der Erfassungs-Norm (wer per Enter absendet, sendet nur dann).
   */
  ausListe: boolean;
}

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
  /** Ein Vorschlag ist übernommen (Klick, Enter oder Tab auf dem markierten). */
  onWahl?: (vorschlag: Vorschlag) => void;
  /**
   * Enter hat den getippten Text übernommen: über den Freitext-Eintrag der offenen Liste, oder bei
   * geschlossener Liste. Bei offener Liste sendet das Feld das Formular nie mit.
   */
  onEnter?: (text: string) => void;
  /** Escape bei geschlossener Liste; bei offener schließt Escape nur die Liste. */
  onEscape?: () => void;
  /**
   * Jede Übernahme mit ihrem Weg, NACH `onChange` und `onWahl`/`onEnter`: ein Listeneintrag per
   * Enter, Tab oder Klick, oder Enter bei geschlossener Liste (der stehende Text). Tippen,
   * Escape und Verlassen ohne Eintrag sind keine Übernahme. Tab bewegt den Fokus danach selbst
   * weiter; wer bei Enter woanders hin will (ETB: in den Inhalt), tut das hier bei `weg: 'enter'`.
   */
  onUebernahme?: (uebernahme: StammdatenFeldUebernahme) => void;
  /**
   * Darf Enter bei geschlossener Liste das umgebende Formular absenden (Erfassungs-Norm)? Vorgabe
   * `true`. `false` verhindert es; der Aufrufer reagiert über `onUebernahme`/`onEnter`.
   */
  enterSendet?: boolean;
}

type WertProps =
  | { nurText: true; value?: string; onChange?: (wert: string) => void }
  | { nurText?: false; value?: StammdatenWert; onChange?: (wert: StammdatenWert) => void };

export type StammdatenFeldProps = BasisProps & WertProps;

const LEER: StammdatenWert = { text: '' };

/**
 * Schlüssel der Listeneinträge in rc-select. Nie der Wert selbst: rc-select markiert beim Tippen
 * die erste Option, deren Wert mit dem Text BEGINNT („Auto scroll“ in `OptionList`), und nicht die
 * oberste; ein unsichtbares Präfix, das niemand tippt, lässt die oberste markiert
 * (`defaultActiveFirstOption`).
 */
const SCHLUESSEL_PRAEFIX = '⁠';
const schluesselVon = (v: Vorschlag) => SCHLUESSEL_PRAEFIX + v.wert;
/** Der Freitext-Eintrag; kein Vorschlag hat einen leeren Wert (`baueVorschlagsliste`). */
const FREITEXT_SCHLUESSEL = SCHLUESSEL_PRAEFIX;

/** Der letzte Listeneintrag (Spec `stammdaten-feld`, Anforderung „Tastatur“). */
const freitextBeschriftung = (text: string) => `„${text}“ als Freitext übernehmen`;

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
 * Tastatur (ETB-Neuentwurf, design.md D5; in jedem Modus): Beim Tippen ist der oberste passende
 * Vorschlag markiert, ↓/↑ verschieben die Markierung. Enter und Tab nehmen den markierten Eintrag
 * und schließen die Liste; Tab springt danach regulär weiter. Der letzte Eintrag „„<Text>“ als
 * Freitext übernehmen“ nimmt den getippten Text unverändert; passt kein Vorschlag, ist er der
 * einzige und damit markiert. Umschalt+Tab und Verlassen nehmen nichts, der getippte Text bleibt
 * stehen. Escape schließt eine offene Liste, erst bei geschlossener meldet das Feld es weiter.
 * Enter bei offener Liste sendet nie; bei geschlossener gilt die Erfassungs-Norm (`enterSendet`).
 * Enter und Tab bei offener Liste nimmt das Feld selbst, rc-select bekommt sie nicht: es hielte
 * bei Tab den Fokus fest (`OptionList`, `preventDefault`), und Enter öffnete eine geschlossene
 * Liste (`BaseSelect` `onInternalKeyDown`).
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
    onUebernahme,
    enterSendet = true,
  } = props;
  const { token, rollen } = useRollen();
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
  /** Wird seit dem letzten Öffnen getippt? Erst dann steht ein einsamer Freitext-Eintrag. */
  const [getippt, setGetippt] = useState(false);
  /**
   * Der markierte Eintrag, wie rc-select ihn meldet (`onActive`: Vorgabe, Pfeile, Maus). Er bleibt
   * über das Schließen stehen, wie rc-selects eigene Markierung; ein veralteter Schlüssel fällt auf
   * den obersten Eintrag zurück (`markierterEintrag`).
   */
  const aktivRef = useRef<string | null>(null);
  /** Läuft gerade ein Enter? Dann bleibt die Liste zu (s. Dateikopf). */
  const enterRef = useRef(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  /** Gerade angelegt, die Quelle hat es aber noch nicht neu geladen. */
  const [angelegt, setAngelegt] = useState<string | null>(null);

  const liste = useMemo(() => baueVorschlagsliste(quellen, text), [quellen, text]);
  /** Alle Vorschläge in der Folge der Liste (Gruppen, dann Demo). */
  const vorschlaege = useMemo(
    () => [...liste.gruppen.flatMap((g) => g.eintraege), ...liste.demo],
    [liste],
  );
  // Freitext trotz Treffer über einen eigenen, letzten Eintrag; er entfällt, wenn der Text schon
  // genau ein Vorschlag ist. Passt kein Vorschlag, steht er nur, solange getippt wird: ein Klick
  // in einen stehenden Wert öffnete sonst eine Liste aus diesem einen Eintrag, und das erste
  // Escape bräche nicht mehr ab. Ohne jede Quelle gibt es keine Liste und damit keinen Eintrag.
  const zeigeFreitext =
    quellen.length > 0 &&
    text.trim() !== '' &&
    !vorschlaege.some((v) => v.wert === text.trim()) &&
    (vorschlaege.length > 0 || getippt);
  const optionen = useMemo(() => {
    const vorschlagsOption = (v: Vorschlag, label: ReactNode) => ({
      value: schluesselVon(v),
      label,
      title: v.label,
      // Die versteckte Liste für Screenreader zeigte sonst den Schlüssel (rc-select `renderItem`).
      'aria-label': v.label,
    });
    return [
      ...liste.gruppen.map((g) => ({
        label: g.titel,
        title: g.titel,
        options: g.eintraege.map((v) => vorschlagsOption(v, v.label)),
      })),
      ...(liste.demo.length > 0
        ? [
            {
              label: DEMO_GROUP,
              title: DEMO_GROUP,
              options: liste.demo.map((v) => vorschlagsOption(v, <DemoLabel>{v.label}</DemoLabel>)),
            },
          ]
        : []),
      ...(zeigeFreitext
        ? [
            {
              value: FREITEXT_SCHLUESSEL,
              label: freitextBeschriftung(text),
              title: freitextBeschriftung(text),
              'aria-label': freitextBeschriftung(text),
              'data-lfh': 'freitext-eintrag',
              // Abgesetzt von den Vorschlägen wie im Entwurf (`Schreibzeile-Zustaende.dc.html`).
              style: { borderTop: `1px solid ${rollen.linie}` },
            },
          ]
        : []),
    ];
  }, [liste, zeigeFreitext, text, rollen.linie]);
  const nachSchluessel = useMemo(() => {
    const karte = new Map<string, Vorschlag>();
    for (const v of vorschlaege) karte.set(schluesselVon(v), v);
    return karte;
  }, [vorschlaege]);

  const listeOffen = offen && optionen.length > 0;

  /** Der Eintrag, den Enter/Tab jetzt nähmen: der markierte, sonst der oberste. */
  function markierterEintrag(): Vorschlag | 'freitext' | null {
    const aktiv = aktivRef.current;
    if (aktiv != null) {
      if (aktiv === FREITEXT_SCHLUESSEL && zeigeFreitext) return 'freitext';
      const v = nachSchluessel.get(aktiv);
      if (v) return v;
    }
    return vorschlaege[0] ?? (zeigeFreitext ? 'freitext' : null);
  }

  const oeffne = (auf: boolean) => {
    if (auf && enterRef.current) return;
    if (!auf) setGetippt(false);
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

  /** Nimmt einen Eintrag der Liste: einen Vorschlag oder den getippten Text. */
  function nimm(eintrag: Vorschlag | 'freitext', weg: UebernahmeWeg) {
    setFehler(null);
    oeffne(false);
    if (eintrag === 'freitext') {
      // Unverändert, und ausdrücklich frei: keine Referenz eines exakten Treffers.
      setze({ text });
      if (weg === 'enter') onEnter?.(text);
      onUebernahme?.({ text, weg, ausListe: true });
      return;
    }
    setze({ text: eintrag.wert, ...(eintrag.ref ? { ref: eintrag.ref } : {}) });
    onWahl?.(eintrag);
    onUebernahme?.({ text: eintrag.wert, vorschlag: eintrag, weg, ausListe: true });
  }

  /** Enter bei geschlossener Liste: der stehende Text gilt. */
  function nimmStehendenText() {
    // Ein exakter Treffer ist kein freier Wert: er bekommt seine Referenz (Modus mit `ref`).
    const treffer = exakterTreffer(text, quellen);
    if (treffer?.ref && !wert.ref) setze({ text, ref: treffer.ref });
    onEnter?.(text);
    onUebernahme?.({ text, weg: 'enter', ausListe: false });
  }

  function beiTasteVorab(e: KeyboardEvent<HTMLElement>) {
    // Nur Tasten im Eingabefeld; der Knopf daneben bedient sich selbst.
    if ((e.target as HTMLElement).getAttribute('role') !== 'combobox') return;
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      enterRef.current = true;
      if (listeOffen) {
        // Selbst nehmen: rc-select bekommt das Enter nicht (s. Dateikopf).
        e.preventDefault();
        e.stopPropagation();
        const eintrag = markierterEintrag();
        if (eintrag) nimm(eintrag, 'enter');
        else oeffne(false);
        return;
      }
      if (!enterSendet) e.preventDefault();
      nimmStehendenText();
      return;
    }
    if (e.key === 'Tab') {
      if (!listeOffen) return;
      // Nie `preventDefault`: der Browser bewegt den Fokus weiter. rc-select bekommt die Taste
      // nicht, es hielte den Fokus fest (s. Dateikopf).
      e.stopPropagation();
      const eintrag = e.shiftKey ? null : markierterEintrag();
      if (eintrag) nimm(eintrag, 'tab');
      else oeffne(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!listeOffen && e.key === 'ArrowDown' && optionen.length > 0) setOffen(true);
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
        onBlur={() => setGetippt(false)}
        // Der oberste Eintrag ist markiert (Spec `stammdaten-feld`, „Tastatur“).
        defaultActiveFirstOption
        onActive={(v) => {
          aktivRef.current = v == null ? null : String(v);
        }}
        onSearch={(eingabe) => {
          setFehler(null);
          setze({ text: eingabe });
          setGetippt(true);
          if (eingabe && !enterRef.current) setOffen(true);
        }}
        // Nur noch der Klick: Enter und Tab nimmt das Feld selbst (`beiTasteVorab`).
        onSelect={(v) => {
          const schluessel = String(v);
          if (schluessel === FREITEXT_SCHLUESSEL) {
            nimm('freitext', 'klick');
            return;
          }
          const vorschlag = nachSchluessel.get(schluessel);
          if (vorschlag) nimm(vorschlag, 'klick');
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
