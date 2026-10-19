import { IconStift } from '../icons';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Button, Space } from 'antd';
import { FeldFehler } from './instrument';
import { useRollen } from './instrument/rollenwerte';
import { wertKnopfStil } from './BemerkungZelle';
import { SpeicherFehler } from './SpeicherHinweis';
import { useFokusRueckgabe } from './useFokusRueckgabe';

/**
 * Inline bearbeitbare Angabe mit BELIEBIGER Eingabe (LFH-472) — Text, Textfeld, Zahl, Auswahl,
 * Datum/Uhrzeit —, optional als Pflichtangabe.
 *
 * ── ABGRENZUNG ZU `BemerkungZelle` ─────────────────────────────────────────────────────
 *
 * `BemerkungZelle` (LFH-369) trägt optionale Freitexte in Listen und steht auf antds
 * `Typography.Text editable`, das nur Text kann. Hier braucht es Zeiteingabe, Select und
 * InputNumber und eine Pflichtangabe, die leer abgelehnt wird. Gemeinsam sind die Anzeige (Wert
 * als Knopf, `wertKnopfStil`, Platzhalter in `bedienText`) und die Fokusrückgabe
 * (`useFokusRueckgabe`) — beide aus EINER Quelle, nicht kopiert.
 *
 * ── DIE REGELN AUS LFH-369, HIER WEITER GÜLTIG ─────────────────────────────────────────
 *
 * - **Der Auslöser nennt die Angabe** („Leitstellen-Nr. bearbeiten"); der Wert ist die
 *   Beschreibung (`aria-describedby`), kein `aria-label`, das den Inhalt verdeckte.
 * - **Ohne Schreibrecht keine Aufforderung**: nur der Wert, leer als „—".
 * - **In einer Liste trägt `kennung` die Zeile in jeden Namen** („Funktion zu Anna bearbeiten“,
 *   LLH-1067), wie bei `BemerkungZelle`; der sichtbare Text bleibt „Funktion eintragen“.
 * - **Fokus fällt nicht auf `<body>`**, auch wenn der neue Wert erst eine Runde später kommt.
 * - Die `keyCode`-Falle von antds `Editable` gilt NICHT: hier sendet das native `<form>` (Enter),
 *   Escape läuft über `key`.
 *
 * ── WAS BEWUSST FEHLT ──────────────────────────────────────────────────────────────────
 *
 * **Kein Speichern beim Verlassen (Blur).** Kalender der Zeiteingabe und Select öffnen Portale; ein Klick
 * darin verlässt die Eingabe, und ein Blur-Speichern schriebe einen halben Zeitpunkt. Gespeichert
 * wird nur ausdrücklich: Enter, Strg/⌘+Enter im Textfeld, oder „Speichern".
 *
 * ── FELDWEISE BEARBEITUNG IN EINER ANSICHT (LLH-1103) ──────────────────────────────────
 *
 * Für die Personendaten (Change `f8218h1i-personendaten-feldweise`, design.md D3) kamen vier
 * optionale Props dazu; ohne sie verhält sich die Angabe wie zuvor.
 * - `pruefe`: Prüfung ohne Server. Der Grund steht nach dem Absenden als `FeldFehler` unter der
 *   Eingabe (`aria-invalid`, `aria-describedby`), der Fokus geht ins Feld, gesendet wird nicht;
 *   danach folgt die Meldung dem Entwurf. Ein unveränderter Wert wird nicht geprüft (Altbestand).
 * - `gesperrt`: der Grund steht sichtbar am Feld (`frontend/AGENTS.md`, „Texte: zeigen statt
 *   erklären“: nie nur im Tooltip), der Auslöser ist `disabled`. Eine offene Bearbeitung ohne
 *   Änderung schließt; ein Entwurf bleibt stehen, damit nichts still verloren geht, sendet aber
 *   nicht, bis die Sperre fällt.
 * - `onEntwurf`: meldet nur die Wechsel zwischen „unverändert“ und „geändert“ (auch beim
 *   Aushängen), für den Merker `components/offeneBearbeitung.tsx`.
 * - `onOeffnen`: jedes Öffnen; der Aufrufer hält dort den Serverstand für den Feld-CAS fest.
 */

/** Was die Eingabe zum Einhängen bekommt. `feld` ist unverändert auf das antd-Element spreizbar. */
export interface InlineEingabe<T> {
  /** Die Zugangsmerkmale `aria-invalid`/`aria-describedby` kommen nur bei einem Prüffehler. */
  feld: {
    id: string;
    'aria-label': string;
    autoFocus: true;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  };
  value: T;
  onChange: (wert: T) => void;
  /**
   * Nur für Eingaben mit Popup (Zeiteingabe, Select, AutoComplete) auf das Element spreizen. Damit
   * schließt Escape zuerst das Popup und verwirft erst beim nächsten Mal die Zeile.
   */
  popup: { onOpenChange: (offen: boolean) => void };
}

export interface InlineAngabeProps<T> {
  /** Name der Angabe — Etikett der Eingabe und Kern jedes zugänglichen Namens. */
  etikett: string;
  /** Menschenlesbare Zeilenkennung für die zugänglichen Namen in einer Liste („… zu Anna“). */
  kennung?: string;
  /** Gespeicherter Wert (Serverstand), Ausgangspunkt jeder Bearbeitung. */
  wert: T;
  /** Darstellung des gefüllten Werts. Ein leerer Wert zeigt stattdessen die Aufforderung bzw. „—". */
  anzeige: ReactNode;
  leer: (wert: T) => boolean;
  /** Wertgleichheit für den Riegel „unverändert → kein Senden". Vorgabe `Object.is`. */
  gleich?: (a: T, b: T) => boolean;
  darfSchreiben: boolean;
  /** Leer wird abgelehnt: kein Senden, alter Wert, Hinweis an der Zeile. */
  pflicht?: boolean;
  /**
   * Für Eingaben, die einen ungültigen Entwurf selbst anzeigen (Koordinate, LFH-1170): `false`
   * sperrt das Senden, die Eingabe bleibt mit dem Entwurf offen. Ohne Angabe ist jeder Entwurf
   * sendbar.
   */
  isValid?: (wert: T) => boolean;
  /** Enter bleibt Zeilenumbruch; gesendet wird mit Strg/⌘+Enter. */
  mehrzeilig?: boolean;
  eingabe: (p: InlineEingabe<T>) => ReactNode;
  /**
   * Eigener Auslöser statt Wertknopf und Aufforderung (LFH-969): für eine Angabe, deren Wert
   * schon an anderer Stelle steht, etwa als Überschrift. Bekommt die Fokusrückgabe (`ref`) und das
   * Öffnen; Name und Trefffläche verantwortet der Aufrufer. Ohne Schreibrecht entfällt er, und
   * es steht nichts da — der Wert steht ja woanders.
   */
  ausloeser?: (p: {
    ref: Ref<HTMLButtonElement>;
    onClick: () => void;
    /** Gesetzt bei `gesperrt`; der Grund steht schon daneben. */
    disabled: boolean;
  }) => ReactNode;
  /**
   * Übernahme. Lehnt bei Ablehnung ab (`mutateAsync`) — dann bleibt die Eingabe mit dem Entwurf
   * offen und der Fehler steht an der Zeile. Erfüllt erst, wenn der neue Wert im Cache steht.
   */
  onSpeichern: (wert: T) => Promise<unknown>;
  /**
   * Prüfung ohne Server (LLH-1103): ein Grund in wenigen Wörtern („höchstens 120“) sperrt das
   * Senden und steht als `FeldFehler` unter der Eingabe; `null` = in Ordnung.
   */
  pruefe?: (wert: T) => string | null;
  /**
   * Sperrgrund in wenigen Wörtern, sichtbar am Feld; der Auslöser ist nicht bedienbar. Steht der
   * Grund schon an anderer Stelle sichtbar (EIN Grund am Kopf eines Abschnitts statt einer Zeile je
   * Feld, LLH-1103), nennt `{ beschreibungId }` dessen Element: das Feld ist gesperrt und verweist
   * per `aria-describedby` darauf, eine eigene Zeile gibt es nicht.
   */
  gesperrt?: string | { beschreibungId: string };
  /** Jedes Öffnen der Eingabe, etwa um den Serverstand für einen Feld-CAS festzuhalten. */
  onOeffnen?: () => void;
  /** Meldet, ob die offene Bearbeitung einen geänderten, ungespeicherten Entwurf hat. */
  onEntwurf?: (geaendert: boolean) => void;
}

/**
 * Stil der Aufforderung „… eintragen“ — rein und exportiert (Muster `wertKnopfStil`). antds
 * Linkknopf bricht nicht um: am Handy lief „Nächste Lagebesprechung eintragen“ über den
 * Paneelrand und weitete den Layout-Viewport auf (LFH-964). Darum `whiteSpace: normal` mit
 * `height: auto`; der Boden aus `controlHeight` hält die Trefffläche auf der Dichte-Staffel.
 */
export function leerKnopfStil(
  token: { controlHeight: number; paddingXS: number },
  bedienText: string,
): CSSProperties {
  return {
    // `bedienText`, die Rolle für blauen TEXT; seit LFH-652 wertgleich mit antds `colorLink`.
    color: bedienText,
    paddingInline: 0,
    paddingBlock: token.paddingXS,
    height: 'auto',
    minHeight: token.controlHeight,
    maxWidth: '100%',
    whiteSpace: 'normal',
    textAlign: 'start',
    justifyContent: 'flex-start',
    overflowWrap: 'anywhere',
  };
}

export function InlineAngabe<T>({
  etikett,
  kennung,
  wert,
  anzeige,
  leer,
  gleich = Object.is,
  darfSchreiben,
  pflicht = false,
  isValid,
  mehrzeilig = false,
  eingabe,
  ausloeser,
  onSpeichern,
  pruefe,
  gesperrt,
  onEntwurf,
  onOeffnen,
}: InlineAngabeProps<T>) {
  const [bearbeitet, setBearbeitet] = useState(false);
  const [entwurf, setEntwurfZustand] = useState<T>(wert);
  // Der Entwurf auch als Ref: die Zeiteingabe übernimmt beim Enter (`onChange`) und das native
  // Absenden folgt im SELBEN Tastendruck, bevor React neu gerendert hat — `abschicken` läse sonst
  // den alten Entwurf und schlösse „unverändert“ (LLH-1070, `anzeige/ZeitpunktEingabe.tsx`, D3).
  const entwurfRef = useRef<T>(wert);
  function setEntwurf(neu: T) {
    entwurfRef.current = neu;
    setEntwurfZustand(neu);
  }
  const [sendet, setSendet] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);
  const [pflichtHinweis, setPflichtHinweis] = useState(false);
  // Erst nach einem gescheiterten Absenden zeigt das Feld den Prüfgrund, danach folgt er dem
  // Entwurf (wie antds Formularmeldung): beim ersten Tippen stünde sonst schon ein Fehler da.
  const [pruefungAktiv, setPruefungAktiv] = useState(false);
  // Riegel in der Absende-Funktion, nicht am Knopf: Enter und ein zweiter Klick liefen sonst an
  // `loading` vorbei, bevor React neu gerendert hat.
  const sendetRef = useRef(false);
  // Offen-Zustand des Eingabe-Popups. Gelesen in der CAPTURE-Phase: ein Popup schließt sich
  // beim Escape im eigenen keydown (vor dem Bubbling ans `<form>`) und meldet `onOpenChange(false)`
  // dabei schon — in der Bubble-Phase stünde hier bereits „zu".
  const popupOffenRef = useRef(false);
  const escSchliesstPopup = useRef(false);
  const knopfRef = useFokusRueckgabe(bearbeitet);
  const { token, rollen } = useRollen();
  const wertId = useId();
  const feldId = useId();
  const pruefId = useId();
  const sperrId = useId();
  /** Zugänglicher Name der Angabe, in einer Liste mit der Zeile. */
  const name = kennung ? `${etikett} zu ${kennung}` : etikett;
  /** Ein leerer Grund sperrt nicht: gesperrt heißt immer mit sichtbarem Grund. */
  const isGesperrt = Boolean(gesperrt);
  /** Der Grund steht hier (Text) oder an anderer Stelle (Kennung seines Elements). */
  const sperrText = typeof gesperrt === 'string' ? gesperrt : undefined;
  const sperrBeschreibung = typeof gesperrt === 'object' ? gesperrt.beschreibungId : sperrId;
  const geaendert = darfSchreiben && bearbeitet && !gleich(entwurf, wert);
  const pruefGrund = bearbeitet && pruefungAktiv && pruefe ? pruefe(entwurf) : null;

  // Die Sperre schließt eine offene Bearbeitung ohne Änderung (Zustand beim Rendern angepasst,
  // nicht per Effekt: sonst stünde einen Frame lang ein bedienbares Feld unter der Sperre). Ein
  // Entwurf bleibt stehen.
  if (isGesperrt && bearbeitet && !geaendert) {
    setBearbeitet(false);
    setFehler(null);
  }

  // Entwurfsmeldung nur an den Flanken; der Aufrufer bekommt seinen jüngsten Rückruf.
  const onEntwurfRef = useRef(onEntwurf);
  const gemeldetRef = useRef(false);
  useEffect(() => {
    onEntwurfRef.current = onEntwurf;
  });
  useEffect(() => {
    if (gemeldetRef.current === geaendert) return;
    gemeldetRef.current = geaendert;
    onEntwurfRef.current?.(geaendert);
  }, [geaendert]);
  useEffect(
    () => () => {
      if (!gemeldetRef.current) return;
      gemeldetRef.current = false;
      onEntwurfRef.current?.(false);
    },
    [],
  );

  if (!darfSchreiben) return ausloeser ? null : <>{leer(wert) ? '—' : anzeige}</>;

  function oeffnen() {
    if (isGesperrt) return;
    popupOffenRef.current = false;
    setEntwurf(wert);
    setFehler(null);
    setPflichtHinweis(false);
    setPruefungAktiv(false);
    setBearbeitet(true);
    onOeffnen?.();
  }

  function schliessen() {
    popupOffenRef.current = false;
    setFehler(null);
    setBearbeitet(false);
  }

  async function abschicken() {
    if (sendetRef.current || isGesperrt) return;
    const entwurf = entwurfRef.current;
    if (pflicht && leer(entwurf)) {
      setPflichtHinweis(true);
      schliessen();
      return;
    }
    if (gleich(entwurf, wert)) {
      schliessen();
      return;
    }
    // Den Grund zeigt die Eingabe selbst (`aria-invalid`, `aria-describedby`); ein zweiter Text
    // hier stünde doppelt. Der Fokus geht ins Feld zurück, damit ein Screenreader ihn vorliest,
    // auch wenn „Speichern“ per Klick kam.
    if (isValid && !isValid(entwurf)) {
      document.getElementById(feldId)?.focus();
      return;
    }
    if (pruefe && pruefe(entwurf) !== null) {
      setPruefungAktiv(true);
      document.getElementById(feldId)?.focus();
      return;
    }
    sendetRef.current = true;
    setSendet(true);
    setFehler(null);
    try {
      await onSpeichern(entwurf);
      schliessen();
    } catch (e) {
      setFehler(e);
    } finally {
      sendetRef.current = false;
      setSendet(false);
    }
  }

  function tastenVorab(e: KeyboardEvent<HTMLFormElement>) {
    // Auswahl/Autovervollständigung melden ihr Popup zusätzlich am Feld; das deckt Eingaben ab,
    // deren Aufrufer `popup` nicht verdrahtet.
    const amFeld = e.target instanceof Element && e.target.getAttribute('aria-expanded') === 'true';
    escSchliesstPopup.current = e.key === 'Escape' && (popupOffenRef.current || amFeld);
  }

  function tasten(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Escape') {
      // Ein offenes Popup der Eingabe schließt zuerst allein; erst das nächste Escape verwirft die
      // Zeile. Keine der antd-Eingaben ruft dabei `preventDefault` (pages/lagekarte/AGENTS.md, LFH-712).
      if (escSchliesstPopup.current) return;
      e.preventDefault();
      schliessen();
    } else if (mehrzeilig && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void abschicken();
    }
  }

  const sperrHinweis = sperrText ? (
    <div id={sperrId} style={{ color: rollen.text2 }}>
      {sperrText}
    </div>
  ) : null;

  if (bearbeitet) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void abschicken();
        }}
        onKeyDownCapture={tastenVorab}
        onKeyDown={tasten}
        style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, minWidth: 0 }}
      >
        {eingabe({
          feld: {
            id: feldId,
            'aria-label': name,
            autoFocus: true,
            ...(pruefGrund ? { 'aria-invalid': true, 'aria-describedby': pruefId } : {}),
          },
          value: entwurf,
          onChange: setEntwurf,
          popup: {
            onOpenChange: (offen) => {
              popupOffenRef.current = offen;
            },
          },
        })}
        <FeldFehler id={pruefId}>{pruefGrund}</FeldFehler>
        <SpeicherFehler fehler={fehler} />
        {sperrHinweis}
        {/* Abstand der Dialogfüße (frontend/AGENTS.md, „Rot steht nicht bündig neben Neutralem“). */}
        <Space wrap size="middle">
          <Button
            type="primary"
            htmlType="submit"
            loading={sendet}
            disabled={isGesperrt}
            aria-label={`${name} speichern`}
            aria-describedby={isGesperrt ? sperrBeschreibung : undefined}
          >
            Speichern
          </Button>
          <Button
            disabled={sendet}
            aria-label={`Bearbeitung von ${name} abbrechen`}
            onClick={schliessen}
          >
            Abbrechen
          </Button>
        </Space>
      </form>
    );
  }

  const hinweis = pflichtHinweis ? (
    <div data-fehler role="status" style={{ color: rollen.alarmText }}>
      {`${etikett} ist eine Pflichtangabe — der bisherige Wert bleibt.`}
    </div>
  ) : null;

  if (ausloeser) {
    return (
      <>
        {ausloeser({ ref: knopfRef, onClick: oeffnen, disabled: isGesperrt })}
        {sperrHinweis}
        {hinweis}
      </>
    );
  }

  if (leer(wert)) {
    return (
      <>
        <Button
          ref={knopfRef}
          type="link"
          disabled={isGesperrt}
          aria-label={kennung ? `${name} eintragen` : undefined}
          aria-describedby={isGesperrt ? sperrBeschreibung : undefined}
          style={leerKnopfStil(token, rollen.bedienText)}
          onClick={oeffnen}
        >
          {`${etikett} eintragen`}
        </Button>
        {sperrHinweis}
        {hinweis}
      </>
    );
  }

  return (
    <>
      <Button
        ref={knopfRef}
        type="text"
        disabled={isGesperrt}
        aria-label={`${name} bearbeiten`}
        aria-describedby={isGesperrt ? `${wertId} ${sperrBeschreibung}` : wertId}
        style={{
          ...wertKnopfStil(token),
          color: 'inherit',
          font: 'inherit',
          marginInline: -token.paddingSM,
        }}
        onClick={oeffnen}
      >
        <span id={wertId}>{anzeige}</span>
        {/* Icon ohne eigenes Vorleseziel (frontend/AGENTS.md, „Ein Emoji ist kein Icon"). */}
        <span aria-hidden="true" style={{ color: token.colorTextSecondary }}>
          <IconStift />
        </span>
      </Button>
      {sperrHinweis}
      {hinweis}
    </>
  );
}
