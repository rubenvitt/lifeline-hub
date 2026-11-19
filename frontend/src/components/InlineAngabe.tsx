import { IconStift } from '../icons';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Button, Popover, Space } from 'antd';
import { useAngabeForm, type OffeneAngabe } from './angabeForm';
import { FeldFehler, Stapel } from './instrument';
import { useRollen } from './instrument/rollenwerte';
import { wertKnopfStil } from './BemerkungZelle';
import { useSelbstanmeldung } from './offeneBearbeitung';
import { SpeicherFehler } from './SpeicherHinweis';
import { useFokusRueckgabe } from './useFokusRueckgabe';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { FeldVermerk } from '../api/types';
import { vermerkKurz } from './feldVermerk';

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
 * **Ungespeichertes ist sichtbar (LLH-1829).** Ab der ersten Änderung steht im Feld „Nicht
 * gespeichert“ und eine Achtungskante (ohne Tastenerklärung, Regel „Text erklärt nie die
 * Bedienung“). Ein Klick daneben schließt ein unverändertes Feld still;
 * ein geändertes bleibt offen, gespeichert wird es dadurch nicht.
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
 *   Aushängen), für den Merker `components/offeneBearbeitung.tsx`. Ohne `onEntwurf` meldet sich
 *   die Angabe selbst beim Merker der Seite an (LLH-1468): unter einem `OffeneBearbeitungProvider`
 *   fragt ein geänderter Entwurf vor dem Verlassen und vor einem Wechsel in der Seite nach, ohne
 *   Provider bleibt es still. Gesperrt, solange ein anderes Feld einen Entwurf hat, ist sie dabei
 *   nur, wenn die Seite den Grund an EINER Stelle zeigt (`OffeneBearbeitungGrundZeile`, LLH-1480,
 *   Fahrzeuge und Material); sie verweist dann darauf, statt ihn unter jede Zelle zu schreiben. Ein
 *   eigenes `gesperrt` geht vor. Wer `onEntwurf` reicht, verdrahtet die Sperre selbst
 *   (`useOffeneBearbeitung`, Vorbild Personendaten).
 * - `onOeffnen`: jedes Öffnen; der Aufrufer hält dort den Serverstand für den Feld-CAS fest.
 * - `onSchliessen`: jedes Schließen einer offenen Bearbeitung (gespeichert, abgebrochen, von der
 *   Sperre geschlossen, ausgehängt). Mit `onOeffnen` hält der Aufrufer ein offenes Feld an seinem
 *   Ort, auch wenn ein neuer Stand es woanders einordnete (Spec `personendaten-bearbeiten`,
 *   „Eine offene Bearbeitung zur Zeit“).
 * - Fällt `darfSchreiben` bei offenem, geändertem Entwurf weg (Datensatz storniert, LLH-1832,
 *   Spec `storno-sperre`), bleibt der Entwurf schreibgeschützt (`feld.readOnly`) stehen, nur mit
 *   „Schließen“; eine unveränderte Bearbeitung schließt.
 * - Erfüllt `onSpeichern` mit {@link OFFEN_LASSEN}, bleibt die Eingabe mit dem Entwurf offen, ohne
 *   Fehler: etwa wenn eine Rückfrage ohne Entscheidung geschlossen wurde (Escape).
 *
 * ── WERT BEIM ÖFFNEN UND FREMDE ÄNDERUNG (LLH-1831) ────────────────────────────────────
 *
 * Change `nvhnqynd-konflikt-und-aenderungsvermerk`, design.md D5, Spec `formularseiten`.
 * - Beim Öffnen friert die Angabe den Serverstand ein und reicht ihn als zweites Argument
 *   `{ beimOeffnen }` an `onSpeichern`: der Aufrufer schickt ihn als `erwartet` (Feld-CAS).
 * - Eine unberührte Eingabe sendet nichts: trifft inzwischen ein fremder Wert ein und die Person
 *   hat nichts eingegeben, schließt „Speichern“ ohne Anfrage (sonst schriebe es den alten Wert
 *   zurück). Hat sie eingegeben, gilt wie immer der Vergleich mit dem aktuellen Wert; so sendet
 *   etwa die Sprechgruppen-Angabe nach einer Teilablehnung, was gegenüber dem Gespeicherten fehlt.
 * - Weicht der Live-`wert` vom eingefrorenen ab, steht im offenen Feld „Inzwischen geändert[ von
 *   X, Zeit]: <Anzeige>“ (`role="status"`); `vermerk` liefert Wer und Wann. Der Entwurf bleibt.
 *
 * ── ANZEIGE MIT EIGENEN BEDIENZIELEN (LLH-1426) ───────────────────────────────────────
 *
 * Der Wertknopf umschließt die Anzeige. Trägt sie selbst Ziele (`tel:`/`mailto:` der
 * Verbindungen), stünde ein Link in einem Button: der Klick auf die Nummer öffnete die Bearbeitung
 * statt zu wählen, und ein Screenreader fände verschachtelte Ziele (axe `nested-interactive`). Mit
 * `bearbeitenDaneben` ist die Anzeige Inhalt, und daneben steht ein eigener Knopf „Bearbeiten“ —
 * die Sprache von `BearbeitbaresPaneel` (Knopf mit dem Wort, Name „… bearbeiten“, Fokus kehrt
 * dorthin zurück). Name und Beschreibung bleiben die des Wertknopfs, die leere Angabe behält ihre
 * Aufforderung „… eintragen“. Steckt ohne den Modus ein Ziel im Wertknopf, warnt die Entwicklung.
 */

/** Bedienziele, die nicht im Wertknopf stehen dürfen (ein Knopf ist nie Hülle eines Ziels). */
const ZIEL_IN_ANZEIGE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]';

/** Was der Fokus per Tab erreicht; für die Tab-Brücke aus dem Popover (LLH-1795). */
const FOKUSZIEL = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Frist der Fokusrückgabe nach dem Schließen einer schwebenden Bearbeitung: lang genug für den
 * neuen Wert nach dem Speichern, kurz genug, dass ein späterer Render den Fokus nicht holt.
 */
const FOKUS_RUECKGABE_MS = 1500;

/** Rückgabe von `onSpeichern`: nichts gespeichert, nichts gescheitert — die Eingabe bleibt offen. */
export const OFFEN_LASSEN = Symbol('offen lassen');

/** Was die Eingabe zum Einhängen bekommt. `feld` ist unverändert auf das antd-Element spreizbar. */
export interface InlineEingabe<T> {
  /** Die Zugangsmerkmale `aria-invalid`/`aria-describedby` kommen nur bei einem Prüffehler. */
  feld: {
    id: string;
    'aria-label': string;
    autoFocus: true;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
    /** Gesetzt, wenn das Schreibrecht bei offenem Entwurf wegfiel (LLH-1832): nur noch lesen. */
    readOnly?: true;
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
  onSpeichern: (wert: T, kontext: { beimOeffnen: T }) => Promise<unknown>;
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
  /** Jedes Schließen einer offenen Bearbeitung, auch durch Sperre oder Aushängen. */
  onSchliessen?: () => void;
  /** Wer den gespeicherten Wert zuletzt gesetzt hat (LLH-1834), für den Hinweis im offenen Feld. */
  vermerk?: FeldVermerk;
  /**
   * Kein Hinweis „Inzwischen geändert“: für Angaben, die ihren Vergleichsstand selbst fortschreiben
   * und den Live-Wert schon mit eigenen Teilschritten ändern (Sprechgruppen-Einzelwege).
   */
  ohneFremdHinweis?: boolean;
  /**
   * Die Anzeige trägt eigene Bedienziele, etwa `tel:`-Links (LLH-1426): sie steht als Inhalt, nicht
   * im Wertknopf, und daneben ein eigener Knopf „Bearbeiten“ (Dateikopf, „Anzeige mit eigenen
   * Bedienzielen“).
   */
  bearbeitenDaneben?: boolean;
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

/**
 * Stil des gefüllten Wertknopfs — rein und exportiert (Muster `wertKnopfStil`). Der Knopf rückt
 * NUR am Anfang um `paddingSM` vor, damit sein Text bündig unter dem Etikett steht; die leere
 * Aufforderung (`leerKnopfStil`) rückt nicht vor. Ein Vorrücken am Ende zöge in einer Flex-Reihe
 * das nächste Ziel heran. Den Vorsprung am Anfang gleicht die Kartenfuge aus (`kartenFelderStil`
 * in `Datensicht.tsx`): hinter einer Aufforderung lag der Wert sonst 7 / 10 px statt ≥ 8 / ≥ 16
 * vor ihr (LLH-1271).
 */
export function wertAngabeStil(token: {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
}): CSSProperties {
  return {
    ...wertKnopfStil(token),
    color: 'inherit',
    font: 'inherit',
    marginInlineStart: -token.paddingSM,
    // Um den Vorsprung breiter als der Behälter: sonst endete der Knopf `paddingSM` vor dessen
    // Rand, und im Kartenfeld, das sich nach dem Inhalt bemisst, bräche der Wert um.
    maxWidth: `calc(100% + ${token.paddingSM}px)`,
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
  onSchliessen,
  vermerk,
  ohneFremdHinweis = false,
  bearbeitenDaneben = false,
}: InlineAngabeProps<T>) {
  const [bearbeitet, setBearbeitet] = useState(false);
  // Der Serverstand beim Öffnen (LLH-1831): Altwert des Feld-CAS und Maß für „unverändert“.
  const [beimOeffnen, setBeimOeffnenZustand] = useState<T>(wert);
  // Hat die Person seit dem Öffnen eingegeben? Unberührt sendet „Speichern“ nichts (LLH-1831).
  const [angefasst, setAngefasstZustand] = useState(false);
  const angefasstRef = useRef(false);
  function setAngefasst(neu: boolean) {
    angefasstRef.current = neu;
    setAngefasstZustand(neu);
  }
  const beimOeffnenRef = useRef<T>(wert);
  function setBeimOeffnen(neu: T) {
    beimOeffnenRef.current = neu;
    setBeimOeffnenZustand(neu);
  }
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
  const { zeitKurz } = useAnzeigeKonventionen();
  const wertId = useId();
  const feldId = useId();
  const pruefId = useId();
  const sperrId = useId();
  /** Zugänglicher Name der Angabe, in einer Liste mit der Zeile. */
  const name = kennung ? `${etikett} zu ${kennung}` : etikett;
  // Wer `onEntwurf` reicht, meldet selbst an; sonst die Angabe beim Merker der Seite (LLH-1468).
  // Deren Sperre gilt nur mit Grundzeile der Seite (LLH-1480); ein eigenes `gesperrt` geht vor.
  const merker = useSelbstanmeldung(name);
  const meldeEntwurf = onEntwurf ?? merker.onEntwurf;
  const sperre = gesperrt || (onEntwurf ? undefined : merker.gesperrt);
  /** Ein leerer Grund sperrt nicht: gesperrt heißt immer mit sichtbarem Grund. */
  const isGesperrt = Boolean(sperre);
  /** Der Grund steht hier (Text) oder an anderer Stelle (Kennung seines Elements). */
  const sperrText = typeof sperre === 'string' ? sperre : undefined;
  const sperrBeschreibung = typeof sperre === 'object' ? sperre.beschreibungId : sperrId;
  /** Der Entwurf weicht vom Stand ab, unabhängig vom Schreibrecht. */
  const entwurfGeaendert = bearbeitet && angefasst && !gleich(entwurf, wert);
  const geaendert = darfSchreiben && entwurfGeaendert;
  /**
   * Das Schreibrecht fiel bei offener Bearbeitung weg, etwa weil der Datensatz storniert wurde
   * (LLH-1832, Spec `storno-sperre`): der Entwurf bleibt schreibgeschützt stehen, damit sein Text
   * nicht still verloren geht, und lässt sich nur noch schließen. Er zählt nicht mehr als
   * Änderung (`geaendert`), der Merker der Seite gibt ihn frei.
   */
  const schreibschutz = !darfSchreiben && bearbeitet;
  const fremdGeaendert = !ohneFremdHinweis && bearbeitet && !gleich(wert, beimOeffnen);
  const pruefGrund = bearbeitet && pruefungAktiv && pruefe ? pruefe(entwurf) : null;

  /**
   * In einer Tabellenzelle schwebt die Bearbeitung (LLH-1795, `components/angabeForm.tsx`): die
   * Anzeige bleibt stehen, Eingabe und Knöpfe öffnen in einem Popover an ihr. Die Tabelle hält
   * höchstens eine offen; dafür meldet sich die Angabe mit diesem gleichbleibenden Griff an.
   */
  const formKontext = useAngabeForm();
  const schwebend = formKontext.form === 'schwebend';
  const geaendertRef = useRef(geaendert);
  geaendertRef.current = geaendert;
  const schliessenRef = useRef<() => void>(() => {});
  const griffRef = useRef<OffeneAngabe>({
    geaendert: () => geaendertRef.current,
    schliessen: () => schliessenRef.current(),
    fokus: () => document.getElementById(feldId)?.focus(),
  });
  const kontextRef = useRef(formKontext);
  kontextRef.current = formKontext;
  useEffect(() => {
    if (!bearbeitet) kontextRef.current.schliesse(griffRef.current);
  }, [bearbeitet]);
  useEffect(() => () => kontextRef.current.schliesse(griffRef.current), []);
  /*
   * Fokusrückgabe aus dem Popover: `useFokusRueckgabe` greift nur, wenn der Fokus beim Schließen
   * auf `body` fällt. Das Popover hält seinen Inhalt aber bis zum Ende der Ausblendung im Baum,
   * der Fokus stünde so noch im verschwindenden Feld. Liegt er dort (oder im Nichts), geht er zurück
   * auf die Anzeige der Zelle.
   */
  // Bis wann der Fokus noch auf die Anzeige zurück soll: nach dem Speichern kommt der neue Wert oft
  // erst einen Takt später, und die Anzeige wechselt (Aufforderung → Wertknopf); der erste Rückweg
  // träfe dann einen Knopf, der gleich darauf aushängt. Eine Frist statt einer Zahl von Renders:
  // ein später Render (neuer Status per SSE) holt den Fokus sonst noch Minuten danach zurück.
  // Ein Zeigerdruck anderswo löscht sie.
  const fokusZurAnzeigeRef = useRef(0);
  // Räumt Timer und Zeigerhörer der laufenden Frist. Auch beim Aushängen: sonst liefe der Timer nach
  // dem Ende der Seite (oder der Testumgebung) ins Leere (`alpha` rot am 18.11.2026).
  const fristRaeumenRef = useRef<(() => void) | null>(null);
  useEffect(() => () => fristRaeumenRef.current?.(), []);
  const popoverInhaltRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  /*
   * Klick daneben (LLH-1829): ein unverändertes Feld schließt still, ein geändertes bleibt offen und
   * zeigt „Nicht gespeichert“. „Innen“ markiert das Formular per `onPointerDownCapture`: React-
   * Ereignisse laufen durch Portale, so zählt auch ein Klick in Kalender oder Auswahlliste. Der Hörer
   * am Dokument kommt danach (React hört an der Wurzel darunter). Den Fokus zieht das Schließen
   * nicht zurück: er gehört dem, was angeklickt wurde.
   */
  const innenRef = useRef(false);
  useEffect(() => {
    if (!bearbeitet) return;
    const beimZeigerdruck = (e: PointerEvent) => {
      if (innenRef.current) {
        innenRef.current = false;
        return;
      }
      if (e.target instanceof Node && anchorRef.current?.contains(e.target)) return;
      if (geaendertRef.current) return;
      popupOffenRef.current = false;
      setFehler(null);
      setBearbeitet(false);
    };
    document.addEventListener('pointerdown', beimZeigerdruck);
    return () => document.removeEventListener('pointerdown', beimZeigerdruck);
  }, [bearbeitet]);
  useLayoutEffect(() => {
    if (bearbeitet || fokusZurAnzeigeRef.current === 0) return;
    if (performance.now() > fokusZurAnzeigeRef.current) {
      fokusZurAnzeigeRef.current = 0;
      return;
    }
    const aktiv = document.activeElement;
    if (aktiv != null && anchorRef.current?.contains(aktiv)) return;
    const imPopover = aktiv != null && (popoverInhaltRef.current?.contains(aktiv) ?? false);
    if (aktiv == null || aktiv === document.body || !aktiv.isConnected || imPopover) {
      const ziel = knopfRef.current?.isConnected
        ? knopfRef.current
        : anchorRef.current?.querySelector<HTMLElement>(FOKUSZIEL);
      ziel?.focus();
    } else {
      // Der Fokus steht anderswo, weil jemand weitergegangen ist: nicht zurückholen.
      fokusZurAnzeigeRef.current = 0;
    }
  });

  // Die Sperre schließt eine offene Bearbeitung ohne Änderung (Zustand beim Rendern angepasst,
  // nicht per Effekt: sonst stünde einen Frame lang ein bedienbares Feld unter der Sperre). Ein
  // Entwurf bleibt stehen.
  if ((isGesperrt || !darfSchreiben) && bearbeitet && !entwurfGeaendert) {
    setBearbeitet(false);
    setFehler(null);
  }

  // Entwurfsmeldung nur an den Flanken; der Aufrufer bekommt seinen jüngsten Rückruf.
  const onEntwurfRef = useRef(meldeEntwurf);
  const gemeldetRef = useRef(false);
  useEffect(() => {
    onEntwurfRef.current = meldeEntwurf;
  });
  useEffect(() => {
    if (gemeldetRef.current === geaendert) return;
    gemeldetRef.current = geaendert;
    onEntwurfRef.current(geaendert);
  }, [geaendert]);
  useEffect(
    () => () => {
      if (!gemeldetRef.current) return;
      gemeldetRef.current = false;
      onEntwurfRef.current(false);
    },
    [],
  );

  // Schließen an der Flanke offen → zu, und beim Aushängen einer offenen Bearbeitung.
  const onSchliessenRef = useRef(onSchliessen);
  const warOffenRef = useRef(false);
  useEffect(() => {
    onSchliessenRef.current = onSchliessen;
  });
  useEffect(() => {
    if (bearbeitet) {
      warOffenRef.current = true;
      return;
    }
    if (!warOffenRef.current) return;
    warOffenRef.current = false;
    onSchliessenRef.current?.();
  }, [bearbeitet]);
  useEffect(
    () => () => {
      if (!warOffenRef.current) return;
      warOffenRef.current = false;
      onSchliessenRef.current?.();
    },
    [],
  );

  // Ein Ziel im Wertknopf ist verschachteltes Markup; der Aufrufer braucht `bearbeitenDaneben`.
  // Gelesen am DOM, weil die Anzeige ein beliebiger Knoten ist; je Instanz nur einmal.
  const zielGewarntRef = useRef(false);
  useEffect(() => {
    if (!import.meta.env.DEV || zielGewarntRef.current || bearbeitenDaneben) return;
    if (!document.getElementById(wertId)?.querySelector(ZIEL_IN_ANZEIGE)) return;
    zielGewarntRef.current = true;
    console.warn(
      `[InlineAngabe] „${name}“: die Anzeige trägt ein eigenes Bedienziel im Wertknopf — ` +
        'mit bearbeitenDaneben steht sie als Inhalt und „Bearbeiten“ daneben (LLH-1426).',
    );
  });

  if (!darfSchreiben && !bearbeitet) return ausloeser ? null : <>{leer(wert) ? '—' : anzeige}</>;

  function oeffnen() {
    if (isGesperrt) return;
    // Schon offen (schwebend bleibt der Wertknopf klickbar): kein zweites Öffnen, das den Entwurf
    // zurücksetzte. Schwebend führt der Knopf in die offene Bearbeitung zurück, sonst wäre sie nach
    // Shift+Tab aus dem Popover per Tastatur nicht mehr erreichbar.
    if (bearbeitet) {
      if (schwebend) griffRef.current.fokus();
      return;
    }
    if (schwebend && !formKontext.oeffne(griffRef.current)) return;
    popupOffenRef.current = false;
    setEntwurf(wert);
    setBeimOeffnen(wert);
    setAngefasst(false);
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
    if (schwebend) merkeFokusRueckgabe();
  }

  function merkeFokusRueckgabe() {
    fristRaeumenRef.current?.();
    fokusZurAnzeigeRef.current = performance.now() + FOKUS_RUECKGABE_MS;
    const clear = () => {
      fokusZurAnzeigeRef.current = 0;
    };
    document.addEventListener('pointerdown', clear, { capture: true, once: true });
    const raeumen = () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', clear, { capture: true });
      if (fristRaeumenRef.current === raeumen) fristRaeumenRef.current = null;
    };
    const timer = window.setTimeout(raeumen, FOKUS_RUECKGABE_MS);
    fristRaeumenRef.current = raeumen;
  }
  schliessenRef.current = schliessen;

  async function abschicken() {
    if (sendetRef.current || isGesperrt || !darfSchreiben) return;
    const entwurf = entwurfRef.current;
    if (pflicht && leer(entwurf)) {
      setPflichtHinweis(true);
      schliessen();
      return;
    }
    if (!angefasstRef.current || gleich(entwurf, wert)) {
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
      const kontext = { beimOeffnen: beimOeffnenRef.current };
      if ((await onSpeichern(entwurf, kontext)) !== OFFEN_LASSEN) schliessen();
    } catch (e) {
      setFehler(e);
    } finally {
      sendetRef.current = false;
      setSendet(false);
    }
  }

  /**
   * Das Popover hängt am Ende von `body`; Tab liefe aus ihm ans Ende des Dokuments (LLH-1795).
   * Eine unveränderte Bearbeitung schließt beim Hinaustabben: Tab geht vom letzten Ziel zum
   * nächsten Ziel nach der Zelle, Shift+Tab vom ersten auf die Anzeige der Zelle; offen stünde das
   * Popover über den nächsten Zielen. Eine geänderte bleibt offen und behält den Fokus
   * (`components/angabeForm.tsx`): Tab läuft im Popover im Kreis, Shift+Tab geht auf die Anzeige,
   * die das Popover nicht deckt, und Enter dort führt zurück.
   */
  function handleTabOut(e: KeyboardEvent<HTMLFormElement>): boolean {
    const ziele = [...e.currentTarget.querySelectorAll<HTMLElement>(FOKUSZIEL)].filter(
      (z) => !z.hasAttribute('disabled'),
    );
    if (ziele.length === 0) return false;
    const anchor = anchorRef.current;
    if (!anchor) return false;
    if (e.shiftKey && e.target === ziele[0]) {
      const previous = anchor.querySelector<HTMLElement>(FOKUSZIEL);
      if (!previous) return false;
      e.preventDefault();
      if (!geaendertRef.current) schliessen();
      previous.focus();
      return true;
    }
    if (!e.shiftKey && e.target === ziele[ziele.length - 1]) {
      if (geaendertRef.current) {
        e.preventDefault();
        ziele[0].focus();
        return true;
      }
      const alle = [...document.querySelectorAll<HTMLElement>(FOKUSZIEL)].filter(
        (z) => !z.hasAttribute('disabled') && !e.currentTarget.contains(z),
      );
      const next = alle.find(
        (z) =>
          !anchor.contains(z) &&
          (anchor.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      );
      if (!next) return false;
      e.preventDefault();
      schliessen();
      next.focus();
      return true;
    }
    return false;
  }

  function tastenVorab(e: KeyboardEvent<HTMLFormElement>) {
    // Auswahl/Autovervollständigung melden ihr Popup zusätzlich am Feld; das deckt Eingaben ab,
    // deren Aufrufer `popup` nicht verdrahtet.
    const amFeld = e.target instanceof Element && e.target.getAttribute('aria-expanded') === 'true';
    escSchliesstPopup.current = e.key === 'Escape' && (popupOffenRef.current || amFeld);
  }

  function tasten(e: KeyboardEvent<HTMLFormElement>) {
    if (schwebend && e.key === 'Tab' && handleTabOut(e)) return;
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

  // „Nicht gespeichert“ ab der ersten Änderung (LLH-1829, Design-Doc „Offenes Inline-Feld“).
  // Schreibgeschützt (LLH-1832) gibt es nichts mehr zu speichern. Ohne Tastenerklärung: Speichern
  // und Abbrechen stehen darunter (`frontend/AGENTS.md`, „Text erklärt nie die Bedienung“).
  const ungespeichert = entwurfGeaendert && !schreibschutz;

  const formular = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void abschicken();
      }}
      onKeyDownCapture={tastenVorab}
      onKeyDown={tasten}
      onPointerDownCapture={() => {
        innenRef.current = true;
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginXS,
        minWidth: 0,
        // Ungespeichert sichtbar (LLH-1829): Achtungskante, solange ein Entwurf offen ist.
        ...(ungespeichert
          ? {
              borderInlineStart: `2px solid ${rollen.achtung}`,
              paddingInlineStart: 'var(--lfh-luft-1)',
            }
          : {}),
      }}
    >
      {eingabe({
        feld: {
          id: feldId,
          'aria-label': name,
          autoFocus: true,
          ...(pruefGrund ? { 'aria-invalid': true, 'aria-describedby': pruefId } : {}),
          ...(schreibschutz ? { readOnly: true } : {}),
        },
        value: entwurf,
        onChange: (neu) => {
          if (schreibschutz) return;
          setAngefasst(true);
          setEntwurf(neu);
        },
        popup: {
          onOpenChange: (offen) => {
            popupOffenRef.current = offen;
          },
        },
      })}
      <FeldFehler id={pruefId}>{pruefGrund}</FeldFehler>
      {fremdGeaendert ? (
        <div role="status" style={{ color: rollen.achtungText }}>
          {`Inzwischen geändert${vermerk ? ` von ${vermerkKurz(vermerk, zeitKurz)}` : ''}: `}
          {leer(wert) ? 'ohne Angabe' : anzeige}
        </div>
      ) : null}
      <SpeicherFehler fehler={fehler} />
      {ungespeichert ? (
        // `aria-live` statt `role="status"`: der Hinweis „Inzwischen geändert“ trägt die Rolle schon.
        <div aria-live="polite" style={{ color: rollen.achtungText }}>
          Nicht gespeichert
        </div>
      ) : null}
      {sperrHinweis}
      {/* Abstand der Dialogfüße (frontend/AGENTS.md, „Rot steht nicht bündig neben Neutralem“). */}
      <Space wrap size="middle">
        {schreibschutz ? (
          <Button aria-label={`Entwurf von ${name} schließen`} onClick={schliessen}>
            Schließen
          </Button>
        ) : (
          <>
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
          </>
        )}
      </Space>
    </form>
  );

  if (bearbeitet && !schwebend) return formular;

  /**
   * Schwebend: die Anzeige (Wertknopf, Aufforderung oder eigener Auslöser) ist der Anker des
   * Popovers. Kein Auslöser am Popover selbst und kein Schließen beim Klick daneben: wie im Fluss
   * schließen nur „Abbrechen“, Escape und das Speichern (Regel „kein Speichern beim Verlassen“).
   */
  const mitPopover = (inhalt: ReactNode): ReactNode =>
    !schwebend ? (
      inhalt
    ) : (
      <Popover
        open={bearbeitet}
        trigger={[]}
        placement="bottomLeft"
        arrow={false}
        destroyOnHidden
        content={
          <div
            ref={popoverInhaltRef}
            style={{ minWidth: 220, maxWidth: 'min(360px, calc(100vw - 32px))' }}
          >
            {formular}
          </div>
        }
      >
        <span
          ref={anchorRef}
          data-lfh="angabe-anker"
          style={{ display: 'inline-block', maxWidth: '100%', minWidth: 0 }}
        >
          {inhalt}
        </span>
      </Popover>
    );

  const hinweis = pflichtHinweis ? (
    <div data-fehler role="status" style={{ color: rollen.alarmText }}>
      {`${etikett} ist eine Pflichtangabe — der bisherige Wert bleibt.`}
    </div>
  ) : null;

  if (ausloeser) {
    return mitPopover(
      <>
        {ausloeser({ ref: knopfRef, onClick: oeffnen, disabled: isGesperrt })}
        {sperrHinweis}
        {hinweis}
      </>,
    );
  }

  if (leer(wert)) {
    return mitPopover(
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
      </>,
    );
  }

  const wertBeschreibung = isGesperrt ? `${wertId} ${sperrBeschreibung}` : wertId;

  if (bearbeitenDaneben) {
    return mitPopover(
      <>
        {/* Ziele stehen ≥ 8 / ≥ 16 px auseinander, auch umgebrochen (LFH-630): `md` = 12/20/24. */}
        <Stapel richtung="zeile" umbruch abstand="md" ausrichten="start">
          <div id={wertId} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {anzeige}
          </div>
          <Button
            ref={knopfRef}
            disabled={isGesperrt}
            aria-label={`${name} bearbeiten`}
            aria-describedby={wertBeschreibung}
            onClick={oeffnen}
          >
            Bearbeiten
          </Button>
        </Stapel>
        {sperrHinweis}
        {hinweis}
      </>,
    );
  }

  return mitPopover(
    <>
      <Button
        ref={knopfRef}
        type="text"
        disabled={isGesperrt}
        aria-label={`${name} bearbeiten`}
        aria-describedby={wertBeschreibung}
        style={wertAngabeStil(token)}
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
    </>,
  );
}
