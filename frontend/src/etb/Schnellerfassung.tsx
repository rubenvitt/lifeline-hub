import { IconAuge, IconBueroklammer, IconKreuz, IconPlus } from '../icons';
import { Alert, Button, Checkbox, Dropdown, Space, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router';
import { DOKUMENT_ACCEPT } from '../api/dokumente';
import { UPLOAD_MAX_GROESSE } from '../api/upload';
import { ApiError, AusgangUnbekannt, type UploadFortschritt } from '../api/client';
import { ETB_ANHAENGE_MAX, ladeEtbAnhangHoch, type NeuerEintrag } from '../api/etb';
import { formatGroesse } from '../karten/formatGroesse';
import { useOnline } from '../offline/useOnline';
import type {
  EinsatzAnzeige,
  EtbBaustein,
  EtbEintragAnzeige,
  EtbTyp,
  MeldeWeg,
} from '../api/types';
import { ERFASSBARE_TYPEN } from './typFarben';
import { etbTyp } from '../theme/statusFarben';
import type { BausteinFelder } from './bausteinEinsetzen';
import MarkdownEditor, { type TextAreaRef } from '../components/MarkdownEditor';
import UploadFortschrittAnzeige from '../components/UploadFortschritt';
import { weiter } from '../components/useUploadFortschritt';
import { Schnellerfassungszeile, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import MetaChip from './MetaChip';
import { useFunkrufnamen } from './funkrufnamen';
import { anVorbelegung, etbStabVorschlaege } from '../fuehrung/funktionsOptionenKern';
import { useFunktionsVorschlaege } from '../fuehrung/useFunktionsVorschlaege';
import SlashMenu, { type SlashMenuHandle } from './SlashMenu';
import BausteinPlatzhalterModal from './BausteinPlatzhalterModal';
import {
  amZeilenanfang,
  baueEintrag,
  einheitAusSchluessel,
  erkenneAtTrigger,
  erkenneSlashTrigger,
  erkenneTypBefehl,
  filterAtEintraege,
  METADATEN_FELDER,
  TYP_BEFEHLE,
  type MetadatenWerte,
  type MetaFeld,
  type SlashEintrag,
} from './schnellerfassungModell';
import type { EntwurfWerte } from './entwuerfe/entwurfModell';
import { neueClientId } from '../offline/clientId';
import { serverJetzt } from '../offline/serveruhr';
import { lageberichtePfad } from '../routing/deeplinks';
import { useSprungSperre } from '../einsatz/useSprungSperre';

interface Props {
  erfassen: (eintrag: NeuerEintrag) => Promise<void>;
  berichtigungZu: EtbEintragAnzeige | null;
  onBerichtigungAbbrechen: () => void;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
  initialWerte?: EntwurfWerte;
  onWerteChange?: (werte: EntwurfWerte) => void;
  /**
   * Zustand des Schalters „Werte behalten". Er liegt beim Aufrufer: `EtbEntwurfsTabs`
   * remountet nach erfolgreichem Erfassen über `key`, ein lokaler `useState` überlebte das nicht.
   */
  werteBehalten?: boolean;
  /** Fehlt der Callback, rendert die Steuerzeile den Schalter nicht (Berichtigung, Bestandsaufrufer). */
  onWerteBehaltenChange?: (behalten: boolean) => void;
  /**
   * Gewählte Anhänge, optional von außen geführt: `EtbEntwurfsTabs` montiert nur den aktiven
   * Tab und hält die Dateien je Entwurf, damit sie einen Tabwechsel überleben. Fehlt das Paar,
   * führt die Schnellerfassung die Liste selbst (Berichtigung). Dateien gehen nie in den
   * Entwurfsspeicher — der ist JSON.
   */
  dateien?: File[];
  onDateienChange?: (dateien: File[]) => void;
  /**
   * Idempotenzschlüssel dieses Entwurfs. `EtbEntwurfsTabs` reicht die Entwurfs-id: sie überlebt
   * den Remount beim Tabwechsel, und ein zweites Absenden desselben Entwurfs dedupliziert der
   * Server. Fehlt sie, hält die Schnellerfassung eine eigene bis zum Erfolg (Berichtigung).
   */
  clientId?: string;
  /**
   * Sendezustand, optional von außen geführt. Nur der aktive Entwurfs-Tab ist montiert; läge
   * der Zustand hier, stünde nach einem Tabwechsel während eines Uploads eine ENTSPERRTE
   * Erfassung da, deren Eingaben der laufende Versand still verwarf. Fehlt das Paar, führt die
   * Schnellerfassung ihn selbst (Berichtigung).
   */
  versand?: Versand;
  onVersandChange?: (aenderung: Partial<Versand>) => void;
}

/** Sendezustand einer Erfassung: läuft ein Versand, wie weit der Upload ist, welcher Grund steht. */
export interface Versand {
  sendet: boolean;
  /** Datei `n` von `von`, mit dem Stand ihrer Übertragung (LFH-878). */
  fortschritt: { n: number; von: number; stand: UploadFortschritt } | null;
  /** Hinweis an der Dateiliste — bleibt stehen bis zur nächsten Wahl oder zum nächsten Absenden. */
  hinweis: string | null;
}

export const VERSAND_RUHE: Versand = { sendet: false, fortschritt: null, hinweis: null };

/**
 * Welche Datei schon oben liegt: nach einem Teilausfall lädt der nächste Versuch nur den
 * Rest. Auf Modulebene, weil der Tabwechsel die Schnellerfassung neu montiert; ein `WeakMap`
 * nach `File` hält keine Datei fest, die niemand mehr kennt. Lehnt der Server fachlich ab,
 * werden die Zuordnungen dieses Versuchs verworfen, weil die ID die Ursache sein könnte.
 */
const hochgeladeneIds = new WeakMap<File, number>();

const ANHANG_OFFLINE = 'Anhänge brauchen eine Verbindung. Der Text lässt sich trotzdem erfassen.';
const ANHANG_ZU_GROSS = `ist zu groß (${UPLOAD_MAX_GROESSE / 1024 / 1024} MiB erlaubt)`;
const ANHANG_GRENZE = `Höchstens ${ETB_ANHAENGE_MAX} Anhänge je Eintrag.`;

/**
 * Dieselbe Datei, neu gewählt: jede Dateiwahl liefert NEUE `File`-Objekte, ein
 * Identitätsvergleich griffe nie. Name, Größe und Änderungszeit trennen zwei Dateien
 * hinreichend — ein Foto zweimal am Eintrag ließe sich wegen der Unveränderlichkeit nicht
 * mehr entfernen.
 */
function gleicheDatei(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

function fehlerGrund(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'unbekannter Fehler';
}

/**
 * Hinweis zu einem gescheiterten Anhang-Upload. Nach dem letzten Byte ohne Antwort
 * (`AusgangUnbekannt`, LFH-878) ist offen, ob die DATEI angekommen ist — sicher ist nur, dass der
 * EINTRAG nicht erfasst ist: er entsteht erst nach allen Uploads. „NICHT abgeschickt“ wäre hier
 * falsch, eine Liste zum Prüfen gibt es nicht (der Anhang hängt noch an keinem Eintrag). Ein
 * erneutes Erfassen lädt die Datei noch einmal hoch; eine ungebundene Erstfassung räumt der
 * Server nach 24 h ab (`src/anhang/repo.rs`, `sweep_verwaiste`).
 */
function uploadFehlerHinweis(datei: File, e: unknown): string {
  if (e instanceof AusgangUnbekannt) {
    return (
      `${datei.name} ist übertragen, aber ohne Antwort geblieben — ob die Datei angekommen ist, ` +
      'ist unklar. Der Eintrag ist nicht erfasst; „Erfassen“ lädt sie erneut hoch.'
    );
  }
  return `${datei.name} konnte nicht hochgeladen werden: ${fehlerGrund(e)}. Der Eintrag ist nicht erfasst.`;
}

const TYP_MENUE = ERFASSBARE_TYPEN.map((t) => ({ key: t, label: etbTyp[t].label }));
const ENTER_HINWEIS =
  'Enter sendet · Shift+Enter neue Zeile · Mehrzeiler mit Cmd/Strg+Enter senden';
/**
 * Kurzform für den Handschirm: nur der Tastaturvertrag, der genau einmal steht
 * (Erfassungs-Norm). Cmd/Strg+Enter entfällt, die Taste gibt es dort nicht.
 */
const ENTER_HINWEIS_KURZ = 'Enter sendet · Shift+Enter neue Zeile';

/**
 * Platzhalter: sagt, WAS in das Feld gehört (der Tastaturvertrag steht in der Hinweiszeile).
 * Unter `md` die Kurzform: der volle Wortlaut brach bei 390 px um, das mitwachsende Feld misst
 * den Platzhalter mit, und die angepinnte Leiste riss den 50-%-Deckel (LFH-373).
 */
const PLATZHALTER = 'Inhalt … ( / für Typ, Felder & Bausteine · @ für Einheit )';
const PLATZHALTER_KURZ = 'Inhalt … ( / für Befehle · @ für Einheit )';

/**
 * Eigener Wortlaut, nicht der aus `components/Erfassung.tsx`: hier gibt es keinen Knopf
 * „Speichern und nächste" — im ETB erfasst jedes Absenden in Serie. Genannt werden die
 * Felder, die `nurUebernahme` kennt.
 */
const UEBERNAHME_ERKLAERUNG =
  'Von, An und Meldeweg bleiben nach dem Erfassen für den nächsten Eintrag stehen. ' +
  'Inhalt, Veranlassung und Ereigniszeit werden immer geleert.';

/**
 * Die Wiederholfelder, die ein Absenden überleben, solange „Werte behalten" an ist
 * (Von/An/Meldeweg sind das Gerüst einer Funkmeldung).
 *
 * `veranlassung` und `ereigniszeit` gehören ABSICHTLICH nicht dazu — eine stehengebliebene
 * Ereigniszeit wäre eine falsche Tatsachenbehauptung.
 *
 * Einziger Ort dieser Auswahl; `EtbEntwurfsTabs` reicht denselben Filter über die Remount-Grenze.
 */
export function nurUebernahme(
  quelle: Pick<MetadatenWerte, 'von' | 'an' | 'meldeweg'>,
): MetadatenWerte {
  return { von: quelle.von, an: quelle.an, meldeweg: quelle.meldeweg };
}

/**
 * Rollt eine waagerecht rollende Zeile so, dass `ziel` darin ganz sichtbar ist — NUR
 * waagerecht, nie das Dokument. Die Chip-Eingabe fokussiert mit `preventScroll`; in der
 * einzeiligen Chip-Zeile unter `md` stünde ein neuer Chip sonst hinter dem rechten Rand.
 * `scrollIntoView` rollte auch die Seite.
 */
export function rolleWaagerechtInsBild(zeile: HTMLElement, ziel: Element): void {
  const z = zeile.getBoundingClientRect();
  const r = ziel.getBoundingClientRect();
  if (r.right > z.right) zeile.scrollLeft += r.right - z.right;
  else if (r.left < z.left) zeile.scrollLeft -= z.left - r.left;
}

/**
 * Die Chip-Zeile unter der Eingabe (gesetzte Felder, „Feld", „Werte behalten").
 *
 * Unter `md` EINZEILIG mit waagerechtem Bildlauf: sonst kostete jeder gesetzte Chip im
 * Handschuh-Betrieb eine eigene Reihe, und die angepinnte Leiste wüchse mit der Zahl der
 * Felder (LFH-373). Rein und exportiert, prüfbar ohne Layout.
 */
export function chipZeileStil(schmal: boolean, token: { marginXS: number }): CSSProperties {
  return {
    display: 'flex',
    flexWrap: schmal ? 'nowrap' : 'wrap',
    alignItems: 'center',
    gap: token.marginXS,
    marginTop: token.marginXS,
    ...(schmal ? { overflowX: 'auto', minWidth: 0 } : {}),
  };
}

export default function Schnellerfassung({
  erfassen,
  berichtigungZu,
  onBerichtigungAbbrechen,
  bausteine,
  einsatz,
  initialWerte,
  onWerteChange,
  werteBehalten = false,
  onWerteBehaltenChange,
  dateien: dateienVonAussen,
  onDateienChange,
  clientId,
  versand: versandVonAussen,
  onVersandChange,
}: Props) {
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  const online = useOnline();
  // Unter `md` steht das Feld auf eigener Zeile: zwischen Typ-Präfix und „Erfassen" bliebe es
  // zu schmal, und die angepinnte Leiste wüchse über die Hälfte des Fensters (LFH-373).
  const { istSchmal } = useViewport();
  const [vorschauOffen, setVorschauOffen] = useState(false);
  const chipZeileRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<TextAreaRef>(null);
  const dateiEingabe = useRef<HTMLInputElement>(null);
  const [eigeneDateien, setEigeneDateien] = useState<File[]>([]);
  const dateien = dateienVonAussen ?? eigeneDateien;
  function setzeDateien(neu: File[]) {
    if (onDateienChange) onDateienChange(neu);
    else setEigeneDateien(neu);
  }
  const [eigenerVersand, setEigenerVersand] = useState<Versand>(VERSAND_RUHE);
  const { sendet, fortschritt, hinweis: anhangHinweis } = versandVonAussen ?? eigenerVersand;
  /** Funktional gemergt: der laufende Versand schreibt aus einer alten Closure heraus. */
  function aendereVersand(aenderung: Partial<Versand>) {
    if (onVersandChange) onVersandChange(aenderung);
    else setEigenerVersand((v) => ({ ...v, ...aenderung }));
  }
  const setAnhangHinweis = (hinweis: string | null) => aendereVersand({ hinweis });
  const setFortschritt = (f: Versand['fortschritt']) => aendereVersand({ fortschritt: f });
  /** Eigener Schlüssel ohne Aufrufer-id: stabil über Fehlversuche, neu nach jedem Erfolg. */
  const eigeneClientId = useRef<string>(neueClientId());
  const menuRef = useRef<SlashMenuHandle>(null);
  const feldKnopfRef = useRef<HTMLButtonElement>(null);

  const [inhalt, setInhalt] = useState(initialWerte?.inhalt ?? '');
  const [typ, setTyp] = useState<EtbTyp>(initialWerte?.typ ?? 'meldung');
  // Nur beim ersten Mount ohne Entwurf vorbelegen. Auch ein bewusst leeres
  // Entwurfsfeld gewinnt; Berichtigungen übernehmen ausschließlich das Original.
  const [metadaten, setMetadaten] = useState<MetadatenWerte>(
    () =>
      initialWerte?.metadaten ??
      (() => {
        // Vorrangregel (LFH-46 Entscheidung 13, eingelöst mit LFH-549): Führungsstelle →
        // erstes eigenes Sachgebiet → nichts.
        const an = berichtigungZu ? undefined : anVorbelegung(einsatz);
        return an ? { an } : {};
      })(),
  );
  const [editFeld, setEditFeld] = useState<MetaFeld | null>(null);
  // Einzeilige Chip-Zeile unter `md`: den gerade bearbeiteten Chip waagerecht ins Bild holen
  // (die Eingabe fokussiert sich selbst). Ohne Chip in Bearbeitung steht die Zeile am Anfang.
  useEffect(() => {
    const zeile = chipZeileRef.current;
    if (!istSchmal || !zeile) return;
    const ziel = document.activeElement;
    if (editFeld == null) zeile.scrollLeft = 0;
    else if (ziel && zeile.contains(ziel)) rolleWaagerechtInsBild(zeile, ziel);
  }, [editFeld, istSchmal]);

  const [menuOffen, setMenuOffen] = useState(false);
  const [menuFilter, setMenuFilter] = useState('');
  const [triggerStart, setTriggerStart] = useState(-1);
  /**
   * Welches Zeichen das Menü geöffnet hat: `/` (Typ am Zeilenanfang, Felder, Bausteine)
   * oder `@` (Funkrufname nach Von/An). Ein Menü, zwei Modi — zwei schwebende Menüs
   * übereinander wären zwei Tastaturziele für dieselben Pfeiltasten.
   */
  const [menuModus, setMenuModus] = useState<'slash' | 'at'>('slash');
  const [typenAnbieten, setTypenAnbieten] = useState(false);

  const [bausteinOffen, setBausteinOffen] = useState<EtbBaustein | null>(null);

  // Funkrufnamen disponierter Fahrzeuge/Einheiten als Vorschläge für von/an.
  // Freitext bleibt Fallback (AC#1).
  const funkrufnamen = useFunkrufnamen(einsatz.id);
  const funktionen = useFunktionsVorschlaege(einsatz.id);
  // Ohne Zugriff auf Lageberichte entfällt der Sprung dorthin (LFH-888, `frontend/AGENTS.md`).
  const lageberichteGesperrt = useSprungSperre(einsatz.id)('lageberichte');
  // „Von“/„An“: Funkrufnamen plus Sachgebiete (LFH-545/549) — der Stabsvorschlag tritt neben die
  // Funkrufnamen, er ersetzt sie nicht.
  const vonAnOptionen = useMemo(
    () => [...funkrufnamen, ...etbStabVorschlaege(funktionen)],
    [funkrufnamen, funktionen],
  );

  // onWerteChange in einer Ref: der Autosave-Effekt feuert NUR auf echte Wertänderungen.
  // In den Deps triggerte jede neue Callback-Referenz des Containers den Effekt erneut
  // (Endlosschleife über entwurfAktualisieren).
  const onWerteChangeRef = useRef(onWerteChange);
  useEffect(() => {
    onWerteChangeRef.current = onWerteChange;
  }, [onWerteChange]);

  const ersterRender = useRef(true);
  useEffect(() => {
    if (ersterRender.current) {
      ersterRender.current = false;
      return; // kein Write beim Mount/initialem Laden
    }
    onWerteChangeRef.current?.({ inhalt, typ, metadaten });
  }, [inhalt, typ, metadaten]);

  // Fokus beim Mount. State-Reset bei Tab-/Modus-Wechsel erfolgt über key-basiertes
  // Remounting im Container (EtbEntwurfsTabs / EtbPage-Berichtigung).
  useEffect(() => {
    textRef.current?.focus();
  }, []);

  /**
   * Klick daneben schließt das Menü.
   *
   * Zwei Ausnahmen, beide notwendig: das **Menü selbst**, weil seine Einträge über
   * `onMouseDown` wählen und `pointerdown` davor läuft — sonst wäre die Mausauswahl tot. Und
   * der **Feld-Knopf**, der selbst umschaltet: sonst schlösse dieser Effekt zuerst und der
   * Klick öffnete danach wieder.
   */
  useEffect(() => {
    if (!menuOffen) return;
    function beiZeigerAb(ereignis: PointerEvent) {
      const ziel = ereignis.target;
      const el = ziel instanceof Element ? ziel : ((ziel as Node | null)?.parentElement ?? null);
      if (el?.closest('[data-slash-menu]')) return;
      if (el && feldKnopfRef.current?.contains(el)) return;
      setMenuOffen(false);
    }
    document.addEventListener('pointerdown', beiZeigerAb);
    return () => document.removeEventListener('pointerdown', beiZeigerAb);
  }, [menuOffen]);

  const gesetzteFelder = METADATEN_FELDER.map((d) => d.feld).filter((f) => metadaten[f] != null);

  // Der Schalter erscheint nur ausserhalb der Berichtigung und nur, wenn ein Aufrufer den
  // Zustand führt. Ohne sichtbaren Schalter wird auch nichts übernommen — eine unsichtbar
  // wirkende Übernahme wäre für den Erfasser nicht erklärbar.
  const zeigeSchalter = !berichtigungZu && onWerteBehaltenChange != null;
  const uebernahmeAktiv = zeigeSchalter && werteBehalten;

  function fokusInsFeld() {
    requestAnimationFrame(() => textRef.current?.focus());
  }

  function aktualisiereTrigger(text: string, caret: number) {
    const slash = erkenneSlashTrigger(text, caret);
    // `@` gibt es im Berichtigungsmodus nicht: dort bleiben Von/An über `/von`, `/an`
    // erreichbar, aber die Zeile soll nichts still umschreiben, was das Original trug.
    const at = slash.aktiv || berichtigungZu ? null : erkenneAtTrigger(text, caret);
    const t = at?.aktiv ? at : slash;
    setMenuModus(at?.aktiv ? 'at' : 'slash');
    setTypenAnbieten(slash.aktiv && !berichtigungZu && amZeilenanfang(text, slash.start));
    setMenuOffen(t.aktiv);
    setMenuFilter(t.filter);
    setTriggerStart(t.start);
  }

  function onInhaltChange(neu: string) {
    // `/anordnung ` am Anfang, ausgetippt statt gewählt, setzt den Typ ohne Menü.
    const befehl = berichtigungZu ? null : erkenneTypBefehl(neu);
    if (befehl) {
      setTyp(befehl.typ);
      setInhalt(befehl.rest);
      aktualisiereTrigger(befehl.rest, befehl.rest.length);
      return;
    }
    setInhalt(neu);
    // Caret-Position aus dem nativen textarea über die antd-Ref, sonst Textende.
    const caret = textRef.current?.resizableTextArea?.textArea?.selectionStart ?? neu.length;
    aktualisiereTrigger(neu, caret);
  }

  /**
   * Entfernt NUR den „/…"-Text, der das Menü ausgelöst hat, und schließt bewusst nicht mit —
   * das tut `waehleEintrag`. Über den Feld-Knopf geöffnet gibt es keinen Trigger-Text
   * (`triggerStart === -1`); ein Schließen hinter diesem frühen Ausstieg ließe das Menü über
   * dem gerade geöffneten Chip-Editor stehen.
   */
  function entferneTriggerText() {
    if (triggerStart < 0) return;
    const ta = textRef.current?.resizableTextArea?.textArea;
    const caret = ta?.selectionStart ?? inhalt.length;
    setInhalt(inhalt.slice(0, triggerStart) + inhalt.slice(caret));
  }

  /*
   * Während des Sendens nimmt die Erfassung keine Änderung an: der Eintrag ist beim Absenden
   * gebildet, spätere Änderungen gingen nicht mit und fielen nach dem Erfolg still weg. Die
   * frühen Ausstiege halten die Wege, die an keinem Knopf hängen (Menü, Modal, Tastatur).
   */
  function waehleEintrag(e: SlashEintrag) {
    if (sendet) return;
    entferneTriggerText();
    // Auf JEDEM Weg hinaus, unabhängig davon, wie das Menü aufging.
    setMenuOffen(false);
    if (e.art === 'typ') {
      setTyp(e.key as EtbTyp);
      fokusInsFeld();
    } else if (e.art === 'einheit') {
      const { feld, wert } = einheitAusSchluessel(e.key);
      setMetadaten((m) => ({ ...m, [feld]: wert }));
      fokusInsFeld();
    } else if (e.art === 'feld') {
      setEditFeld(e.key as MetaFeld);
    } else {
      const b = bausteine.find((x) => String(x.id) === e.key) ?? null;
      setBausteinOffen(b);
    }
  }

  function commitFeld(feld: MetaFeld, wert: string | dayjs.Dayjs | MeldeWeg) {
    if (sendet) return;
    setMetadaten((m) => ({ ...m, [feld]: wert }));
    setEditFeld(null);
    fokusInsFeld();
  }

  function bausteinEinsetzen(felder: BausteinFelder) {
    if (sendet) return;
    setInhalt(felder.inhalt);
    setMetadaten((m) => ({
      ...m,
      ...(felder.meldeweg ? { meldeweg: felder.meldeweg } : {}),
      ...(felder.veranlassung ? { veranlassung: felder.veranlassung } : {}),
    }));
    if (felder.typ) setTyp(felder.typ);
    setBausteinOffen(null);
    fokusInsFeld();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (menuOffen && menuRef.current?.handleKey(e.key)) {
      e.preventDefault();
      return;
    }
    const istSendeTaste =
      e.key === 'Enter' &&
      !e.repeat &&
      !e.shiftKey &&
      !e.altKey &&
      (e.ctrlKey || e.metaKey || (inhalt.trim() !== '' && !inhalt.includes('\n')));
    if (istSendeTaste && editFeld == null) {
      e.preventDefault();
      void absenden();
    }
  }

  /**
   * Dateiwahl: über 25 MiB, über der Höchstzahl und doppelt Gewähltes wird schon hier
   * abgewiesen, jeweils mit Grund — nicht erst nach dem Upload.
   */
  function dateienGewaehlt(liste: FileList | null) {
    const neu = [...dateien];
    const gruende: string[] = [];
    for (const d of Array.from(liste ?? [])) {
      if (d.size > UPLOAD_MAX_GROESSE) gruende.push(`${d.name} ${ANHANG_ZU_GROSS}`);
      else if (neu.some((x) => gleicheDatei(x, d))) gruende.push(`${d.name} ist schon gewählt`);
      else if (neu.length >= ETB_ANHAENGE_MAX)
        gruende.push(`${d.name}: höchstens ${ETB_ANHAENGE_MAX} Anhänge je Eintrag`);
      else neu.push(d);
    }
    setAnhangHinweis(gruende.length > 0 ? gruende.join(' · ') : null);
    setzeDateien(neu);
    // Dieselbe Datei soll sich nach dem Entfernen erneut wählen lassen.
    if (dateiEingabe.current) dateiEingabe.current.value = '';
  }

  /**
   * Lädt die gewählten Dateien nacheinander hoch (eine je Anfrage) und liefert ihre IDs in
   * Wahlreihenfolge — oder `null`, wenn eine scheitert; dann steht der Grund am Hinweis und
   * es wird NICHT erfasst.
   */
  async function ladeAnhaengeHoch(): Promise<number[] | null> {
    const ids: number[] = [];
    for (const [i, d] of dateien.entries()) {
      let id = hochgeladeneIds.get(d);
      if (id == null) {
        const n = i + 1;
        const von = dateien.length;
        // Sofort ein Balken ohne Zahl; danach nur vorwärts (`weiter`), wie im Ablegen-Dialog.
        let stand: UploadFortschritt = { phase: 'senden', anteil: null };
        let laeuft = true;
        setFortschritt({ n, von, stand });
        try {
          id = (
            await ladeEtbAnhangHoch(einsatz.id, d, (neu) => {
              if (!laeuft) return;
              stand = weiter(stand, neu);
              setFortschritt({ n, von, stand });
            })
          ).id;
        } catch (e) {
          setAnhangHinweis(uploadFehlerHinweis(d, e));
          return null;
        } finally {
          laeuft = false;
        }
        hochgeladeneIds.set(d, id);
      }
      ids.push(id);
    }
    return ids;
  }

  async function absenden() {
    if (sendet || inhalt.trim() === '') return;
    // Nur der UPLOAD braucht Netz. Mit Dateien in der Liste wird ohne Verbindung abgewiesen, ohne
    // etwas zu leeren — ein Eintrag ohne die gewählten Dateien wäre eine stille Auslassung.
    // Über der Höchstzahl gar nicht erst hochladen: das Erfassen scheiterte mit 400, und die
    // Dateien lägen bis zum Aufräumlauf verwaist oben.
    if (dateien.length > ETB_ANHAENGE_MAX) {
      setAnhangHinweis(`${ANHANG_GRENZE} Entferne ${dateien.length - ETB_ANHAENGE_MAX}.`);
      return;
    }
    if (dateien.length > 0 && !online) {
      setAnhangHinweis(
        'Ohne Verbindung lassen sich keine Anhänge senden. ' +
          'Entferne sie, um den Text jetzt zu erfassen.',
      );
      return;
    }
    // Die Zeit gilt ab dem Absenden, nicht ab dem Ende des Uploads — sonst verschöbe ein langer
    // Upload Ereigniszeit und `erfasst_lokal_at`. Sie gilt nach der Serveruhr, soweit der Versatz
    // bekannt ist: eine vorgehende Geräteuhr datierte den Eintrag sonst zu spät (LFH-895,
    // `openspec/changes/archive/2026-10-04-lfh-895-ereigniszeit-serveruhr/design.md`, D1/D2).
    const jetztIso = serverJetzt().toISOString();
    aendereVersand({ sendet: true, hinweis: null });
    try {
      const anhangIds = await ladeAnhaengeHoch();
      setFortschritt(null);
      if (anhangIds == null) return;
      const eintrag: NeuerEintrag = {
        ...baueEintrag({
          inhalt,
          typ,
          metadaten,
          berichtigungZuId: berichtigungZu ? berichtigungZu.id : undefined,
          jetztIso,
        }),
        client_id: clientId ?? eigeneClientId.current,
        ...(anhangIds.length > 0 ? { anhang_ids: anhangIds } : {}),
      };
      try {
        await erfassen(eintrag);
      } catch (e) {
        // Die IDs dieses Versuchs nur verwerfen, wenn die Ablehnung an ihnen liegen kann
        // (400/422: unbekannt, gebunden, zu viele). Bei 403 oder 409 sind die Dateien frei und
        // unverändert oben — ein zweiter Upload wäre nur Volumen und verwaiste Bytes.
        if (e instanceof ApiError && (e.status === 400 || e.status === 422)) {
          for (const d of dateien) hochgeladeneIds.delete(d);
        }
        // 409: die client_id steht schon für einen anderen Eintrag (zweiter Browser-Tab), oder der
        // Einsatz ist abgeschlossen. Der Wortlaut bleibt, der Grund steht AN der Erfassung, und der
        // nächste Versuch nimmt einen neuen Schlüssel; mit Aufrufer-id gibt `EtbEntwurfsTabs` dem
        // Entwurf eine neue.
        if (e instanceof ApiError && e.status === 409) {
          eigeneClientId.current = neueClientId();
          setAnhangHinweis(e.message);
        }
        throw e;
      }
      eigeneClientId.current = neueClientId();
      setInhalt('');
      // Die Dateiliste geht immer — auch mit „Werte behalten": eine Datei gehört zu genau
      // einem Eintrag (`nurUebernahme` kennt keine Dateien).
      setzeDateien([]);
      // Wertübernahme: Von/An/Meldeweg bleiben stehen, alles andere fällt weg. Im
      // Berichtigungsmodus bleibt es beim vollständigen Leeren (dort gibt es auch keinen
      // Schalter). Greift für Aufrufer OHNE Remount; `EtbEntwurfsTabs` remountet und setzt
      // dieselben Felder über `initialWerte` wieder ein.
      setMetadaten((m) => (uebernahmeAktiv ? nurUebernahme(m) : {}));
      setEditFeld(null);
      setMenuOffen(false);
      if (berichtigungZu) onBerichtigungAbbrechen();
      fokusInsFeld();
    } catch {
      // Abgelehnt: die Meldung zeigt der Aufrufer (`EtbPage`, `message.error`), der
      // Wortlaut bleibt im Feld stehen (Erfassungs-Norm, `onErfassen` muss ablehnen).
      // Weiterwerfen hieße hier nur eine unbehandelte Zurückweisung aus `void absenden()`.
    } finally {
      aendereVersand({ sendet: false, fortschritt: null });
    }
  }

  /*
   * DER PRÄFIX IST DER TYPWÄHLER (`/anordnung` in der Befehlszelle): er zeigt den gewählten Typ
   * und öffnet auf Klick die Typen als Menü — der Weg für Maus und Handschuh; die Tastatur nimmt
   * `/typ` am Zeilenanfang. Einen zweiten Wähler für denselben Wert gibt es bewusst nicht. Im
   * Berichtigungsmodus ist der Typ fest und der Präfix Text.
   *
   * Der zugängliche Name enthält den sichtbaren Befehl (WCAG 2.5.3 „Label in Name").
   */
  const praefix = berichtigungZu ? (
    '/berichtigung'
  ) : (
    <Dropdown
      trigger={['click']}
      autoFocus
      disabled={sendet}
      menu={{
        items: TYP_MENUE,
        selectable: true,
        selectedKeys: [typ],
        onClick: ({ key }) => {
          if (sendet) return;
          setTyp(key as EtbTyp);
          fokusInsFeld();
        },
      }}
    >
      <Button
        type="text"
        disabled={sendet}
        aria-label={`Eintragstyp /${typ} ändern`}
        style={{ font: 'inherit', color: 'inherit', paddingInline: token.paddingXS }}
      >
        /{typ}
      </Button>
    </Dropdown>
  );

  /*
   * DIE HINWEISZEILE trägt den Tastaturvertrag — EINMAL: nicht im Platzhalter, nicht zusätzlich
   * als „↵ eintragen". Genannt wird nur, was es gibt: `# Koordinate` des Entwurfs hat keinen Weg
   * in den Eintrag; „⧖ Nachtrag" steht, weil `/zeit` eine zurückliegende Ereigniszeit setzt.
   */
  // „Werte behalten": ab `md` rechts in der Chip-Zeile, darunter in der Hinweiszeile — in der
  // einzeilig rollenden Chip-Zeile läge er sonst hinter dem Bildlauf.
  const schalter = zeigeSchalter ? (
    <Tooltip title={UEBERNAHME_ERKLAERUNG}>
      {/* Gesperrt beim Senden: der laufende Versand hat die Übernahme schon gelesen. */}
      <Checkbox
        checked={werteBehalten}
        disabled={sendet}
        onChange={(e) => onWerteBehaltenChange?.(e.target.checked)}
      >
        <Typography.Text type="secondary">Werte behalten</Typography.Text>
      </Checkbox>
    </Tooltip>
  ) : null;

  // Unter `md` die Kurzform: die volle Zeile bräche auf dem Handschirm dreizeilig um.
  const hinweiszeile = istSchmal ? (
    <>
      <span>{ENTER_HINWEIS_KURZ}</span>
      {schalter && <span style={{ marginInlineStart: 'auto' }}>{schalter}</span>}
    </>
  ) : (
    <>
      {!berichtigungZu && (
        <span style={{ color: rollen.gedaempft }}>{TYP_BEFEHLE.map((t) => `/${t}`).join(' ')}</span>
      )}
      {!berichtigungZu && <span>@ Einheit</span>}
      <span>/zeit ⧖ Nachtrag</span>
      <span>{ENTER_HINWEIS}</span>
    </>
  );

  const einheitenTreffer =
    menuModus === 'at' ? filterAtEintraege(menuFilter, funkrufnamen, typ) : null;

  const feldKnopf = (
    <Button
      ref={feldKnopfRef}
      type="dashed"
      disabled={sendet}
      icon={
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          <IconPlus />
        </span>
      }
      onClick={() => {
        setMenuFilter('');
        setTriggerStart(-1);
        setMenuModus('slash');
        setTypenAnbieten(false);
        setMenuOffen((o) => !o);
      }}
    >
      Feld
    </Button>
  );

  // „Anhang" steht bei „Feld": ab `md` hinter den Chips, darunter vorn.
  const anGrenze = dateien.length >= ETB_ANHAENGE_MAX;
  const anhangTeil = (
    <>
      {/* „Anhang": ein antd-Knopf plus unsichtbare Dateieingabe statt antds `Upload` — der wickelte
         den Knopf in ein zweites `role="button"` mit eigenem Tabstopp. So bleibt EIN Bedienziel,
         und die Höhe kommt aus `controlHeight`. */}
      <Button
        type="dashed"
        disabled={!online || sendet || anGrenze}
        icon={
          <span aria-hidden="true" style={{ display: 'inline-flex' }}>
            <IconBueroklammer />
          </span>
        }
        onClick={() => dateiEingabe.current?.click()}
      >
        Anhang
      </Button>
      <input
        ref={dateiEingabe}
        type="file"
        multiple
        hidden
        disabled={!online || sendet}
        accept={DOKUMENT_ACCEPT}
        data-lfh="etb-anhang-eingabe"
        onChange={(e) => dateienGewaehlt(e.target.files)}
      />
      {/* Zweiter Kanal neben dem Grau (WCAG 1.4.1): der Grund steht als Satz daneben. In `text2`,
         nicht `Typography` „secondary": der hält am Tag den 7 : 1-Boden auf dem Grund der
         Erfassung nicht (e2e `etb-anhang-pruefliste`). */}
      {!online && <span style={{ color: rollen.text2 }}>{ANHANG_OFFLINE}</span>}
      {online && anGrenze && <span style={{ color: rollen.text2 }}>{ANHANG_GRENZE}</span>}
    </>
  );

  return (
    // `etb-erfassung-card` trägt keine CSS-Regel, bleibt aber: `e2e/seitenrinne.spec.ts` misst an
    // ihr, dass der Inhalt der Leiste auf der Seitenrinne steht.
    <div className="etb-erfassung-card" data-lfh="etb-erfassung">
      {berichtigungZu && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title={`Berichtigung zu Nr. ${berichtigungZu.lfd_nr}`}
          action={
            // Gesperrt, solange sie gesendet wird: der Versand liefe sonst trotzdem durch.
            <Button disabled={sendet} onClick={onBerichtigungAbbrechen}>
              Abbrechen
            </Button>
          }
        />
      )}

      <div style={{ position: 'relative' }}>
        <Schnellerfassungszeile
          gestapelt={istSchmal}
          praefix={praefix}
          hinweis={
            // „Vorschau" neben „Erfassen" statt auf eigener Zeile: eine eigene Knopfzeile kostete im
            // Handschuh-Betrieb eine volle Steuerhöhe der angepinnten Leiste.
            <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
              <Button
                type="text"
                icon={
                  <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                    <IconAuge />
                  </span>
                }
                aria-pressed={vorschauOffen}
                onClick={() => setVorschauOffen((v) => !v)}
              >
                Vorschau
              </Button>
              <Button type="primary" loading={sendet} onClick={() => void absenden()}>
                {fortschritt ? `Lädt hoch (${fortschritt.n}/${fortschritt.von}) …` : 'Erfassen'}
              </Button>
            </div>
          }
          hinweiszeile={hinweiszeile}
        >
          {/* Die Schnellerfassung steht ohne eigene Überschrift unter dem Seitentitel (h1). */}
          <MarkdownEditor
            ref={textRef}
            unterEbene={1}
            layout="toggle"
            variante="kompakt"
            placeholder={istSchmal ? PLATZHALTER_KURZ : PLATZHALTER}
            autoSize={{ minRows: 1, maxRows: 4 }}
            umschalterAussen
            vorschauOffen={vorschauOffen}
            value={inhalt}
            onChange={onInhaltChange}
            onKeyDown={onKeyDown}
            readOnly={sendet}
          />
        </Schnellerfassungszeile>
        <SlashMenu
          ref={menuRef}
          offen={menuOffen}
          filter={menuFilter}
          // Berichtigung: Felder-Erfassung bleibt verfügbar, nur die Bausteine-Sektion
          // entfällt (leere Liste → SlashMenu rendert die Bausteine-Sektion nicht).
          bausteine={berichtigungZu ? [] : bausteine}
          gesetzteFelder={gesetzteFelder}
          typenAnbieten={typenAnbieten}
          einheiten={einheitenTreffer}
          richtung="oben"
          onWahl={waehleEintrag}
          onSchliessen={() => setMenuOffen(false)}
        />
      </div>

      {/* Chip-Leiste: die gesetzten Felder, der Weg zu weiteren — und rechts, abgesetzt, die
         EINSTELLUNG „Werte behalten". Nicht neben „Erfassen" und nicht zwischen Aktionen: ein
         Umschalter in einer Knopfreihe wirkt wirkungslos (`components/Erfassung.tsx`). */}
      <div ref={chipZeileRef} style={chipZeileStil(istSchmal, token)}>
        {/* `flexShrink: 0` unter `md`: sonst schrumpfte die Gruppe auf die Zeilenbreite, und die Chips
           brächen ihren Text IN sich um — die Leiste wüchse trotz einzeiliger Zeile. */}
        <Space wrap={!istSchmal} style={istSchmal ? { flexShrink: 0 } : undefined}>
          {/* Unter `md` steht „Feld" VORN: in der einzeilig rollenden Zeile rutschte er sonst hinter die
             gesetzten Chips aus dem Bild. */}
          {istSchmal && feldKnopf}
          {istSchmal && anhangTeil}
          {gesetzteFelder.map((feld) => (
            <MetaChip
              key={`${feld}-${editFeld === feld ? 'edit' : 'view'}`}
              feld={feld}
              editing={editFeld === feld}
              wert={metadaten[feld]}
              optionen={feld === 'von' || feld === 'an' ? vonAnOptionen : undefined}
              onCommit={commitFeld}
              onCancel={() => {
                setEditFeld(null);
                fokusInsFeld();
              }}
              onRemove={(f) => {
                if (!sendet) setMetadaten((m) => ({ ...m, [f]: undefined }));
              }}
              onEdit={(f) => {
                if (!sendet) setEditFeld(f);
              }}
              gesperrt={sendet}
            />
          ))}
          {editFeld != null && metadaten[editFeld] == null && (
            <MetaChip
              key={`${editFeld}-edit-new`}
              feld={editFeld}
              editing
              wert={undefined}
              optionen={editFeld === 'von' || editFeld === 'an' ? vonAnOptionen : undefined}
              onCommit={commitFeld}
              onCancel={() => {
                setEditFeld(null);
                fokusInsFeld();
              }}
              onRemove={() => setEditFeld(null)}
              onEdit={() => {}}
              // Ein beim Absenden offener Editor nimmt beim Senden nichts an (LFH-748).
              gesperrt={sendet}
            />
          )}
          {!istSchmal && feldKnopf}
          {!istSchmal && anhangTeil}
          {!berichtigungZu && typ === 'lage' && !lageberichteGesperrt && (
            // Gesperrt beim Senden: der Sprung hängte die Erfassung ab, der Versand liefe unsichtbar
            // weiter und ein Upload-Fehler stünde nirgends.
            <Button
              type="link"
              disabled={sendet}
              onClick={() => navigate(lageberichtePfad(einsatz.id))}
            >
              Als strukturierten Lagebericht erfassen →
            </Button>
          )}
        </Space>
        {!istSchmal && zeigeSchalter && (
          <div style={{ marginInlineStart: 'auto', flexShrink: 0 }}>{schalter}</div>
        )}
      </div>

      {dateien.length > 0 && (
        <ul
          aria-label="Gewählte Anhänge"
          data-lfh="etb-anhang-liste"
          style={{
            listStyle: 'none',
            margin: 0,
            marginTop: token.marginXS,
            padding: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: token.marginXS,
          }}
        >
          {dateien.map((d, i) => (
            <li
              key={`${d.name}-${i}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}
            >
              <span>
                {d.name} · {formatGroesse(d.size)}
              </span>
              <Button
                type="text"
                disabled={sendet}
                aria-label={
                  dateien.filter((x) => x.name === d.name).length > 1
                    ? `Anhang ${i + 1}, ${d.name} entfernen`
                    : `Anhang ${d.name} entfernen`
                }
                icon={
                  <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                    <IconKreuz />
                  </span>
                }
                onClick={() => setzeDateien(dateien.filter((x) => x !== d))}
              />
            </li>
          ))}
        </ul>
      )}
      {fortschritt && (
        <div style={{ marginTop: token.marginXS }}>
          <UploadFortschrittAnzeige stand={fortschritt.stand} />
        </div>
      )}
      {anhangHinweis && (
        <Alert type="error" showIcon style={{ marginTop: token.marginXS }} title={anhangHinweis} />
      )}

      <BausteinPlatzhalterModal
        baustein={bausteinOffen}
        einsatz={einsatz}
        onEinsetzen={bausteinEinsetzen}
        onAbbrechenAll={() => setBausteinOffen(null)}
      />
    </div>
  );
}
