import { Alert, Button, Checkbox, Dropdown, Space, Tooltip, Typography } from 'antd';
import { CloseOutlined, EyeOutlined, PaperClipOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { DOKUMENT_ACCEPT, DOKUMENT_MAX_GROESSE } from '../api/dokumente';
import { ladeEtbAnhangHoch, type NeuerEintrag } from '../api/etb';
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
import { Schnellerfassungszeile, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import MetaChip from './MetaChip';
import { useFunkrufnamen } from './funkrufnamen';
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

interface Props {
  erfassen: (eintrag: NeuerEintrag) => Promise<void>;
  berichtigungZu: EtbEintragAnzeige | null;
  onBerichtigungAbbrechen: () => void;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
  initialWerte?: EntwurfWerte;
  onWerteChange?: (werte: EntwurfWerte) => void;
  /**
   * Zustand des Schalters „Werte behalten" (LFH-332/H61). Er liegt bewusst beim
   * Aufrufer: `EtbEntwurfsTabs` schliesst nach erfolgreichem Erfassen den Entwurfs-Tab
   * und erzwingt über `key` einen Remount — ein Zustand im `useState` dieser Komponente
   * überlebte das nicht.
   */
  werteBehalten?: boolean;
  /** Fehlt der Callback, rendert die Steuerzeile den Schalter nicht (Berichtigung, Bestandsaufrufer). */
  onWerteBehaltenChange?: (behalten: boolean) => void;
  /**
   * Gewählte Anhänge, optional von außen geführt (LFH-117, design.md D9): `EtbEntwurfsTabs`
   * montiert nur den aktiven Tab und hält die Dateien je Entwurf, damit sie einen Tabwechsel
   * überleben. Fehlt das Paar, führt die Schnellerfassung die Liste selbst (Berichtigung).
   * Dateien gehen nie in den Entwurfsspeicher — der ist JSON.
   */
  dateien?: File[];
  onDateienChange?: (dateien: File[]) => void;
  /**
   * Idempotenzschlüssel dieses Entwurfs (LFH-117, Review). `EtbEntwurfsTabs` reicht die
   * Entwurfs-id: sie überlebt den Remount beim Tabwechsel, und ein zweites Absenden desselben
   * Entwurfs, während das erste noch läuft, dedupliziert der Server. Fehlt sie, hält die
   * Schnellerfassung eine eigene bis zum Erfolg (Berichtigung).
   */
  clientId?: string;
  /**
   * Sendezustand, optional von außen geführt (LFH-117, Review C1). Nur der aktive Entwurfs-Tab
   * ist montiert; läge der Zustand hier, stünde nach einem Tabwechsel während eines Uploads
   * eine frische, ENTSPERRTE Schnellerfassung da — und was man dort tippte, verwarf der noch
   * laufende Versand still. `EtbEntwurfsTabs` hält ihn deshalb je Entwurf. Fehlt das Paar,
   * führt die Schnellerfassung ihn selbst (Berichtigung).
   */
  versand?: Versand;
  onVersandChange?: (aenderung: Partial<Versand>) => void;
}

/** Sendezustand einer Erfassung: läuft ein Versand, wie weit der Upload ist, welcher Grund steht. */
export interface Versand {
  sendet: boolean;
  fortschritt: { n: number; von: number } | null;
  /** Hinweis an der Dateiliste — bleibt stehen bis zur nächsten Wahl oder zum nächsten Absenden. */
  hinweis: string | null;
}

export const VERSAND_RUHE: Versand = { sendet: false, fortschritt: null, hinweis: null };

/**
 * Welche Datei schon oben liegt (LFH-117, design.md D9): bei einem Teilausfall — Datei 1
 * oben, Datei 2 gescheitert — lädt der nächste Versuch nur Datei 2. Auf Modulebene, weil
 * `EtbEntwurfsTabs` die Schnellerfassung beim Tabwechsel neu montiert; ein `WeakMap` nach
 * `File` hält keine Datei fest, die niemand mehr kennt. Lehnt der Server den Eintrag
 * fachlich ab, werden die Zuordnungen dieses Versuchs verworfen: die ID könnte die Ursache
 * sein (etwa ein inzwischen weggeräumter Anhang).
 */
const hochgeladeneIds = new WeakMap<File, number>();

const ANHANG_OFFLINE = 'Anhänge brauchen eine Verbindung. Der Text lässt sich trotzdem erfassen.';
const ANHANG_ZU_GROSS = `ist zu groß (${DOKUMENT_MAX_GROESSE / 1024 / 1024} MiB erlaubt)`;

function fehlerGrund(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'unbekannter Fehler';
}

const TYP_MENUE = ERFASSBARE_TYPEN.map((t) => ({ key: t, label: etbTyp[t].label }));
const ENTER_HINWEIS =
  'Enter sendet · Shift+Enter neue Zeile · Mehrzeiler mit Cmd/Strg+Enter senden';
/**
 * Kurzform für den Handschirm (LFH-373, Checkpoint 25.09.2026): nur der Tastaturvertrag.
 * Befehle und `@ Einheit` stehen schon im Platzhalter; der Vertrag stand NUR in der
 * Hinweiszeile und bleibt deshalb stehen — genau einmal (Erfassungs-Norm, LFH-335).
 * Cmd/Strg+Enter entfällt: auf einem Handschirm gibt es die Taste nicht.
 */
const ENTER_HINWEIS_KURZ = 'Enter sendet · Shift+Enter neue Zeile';

/**
 * Platzhalter: sagt, WAS in das Feld gehört (der Tastaturvertrag steht in der Hinweiszeile).
 * Unter `md` die Kurzform (LFH-373, in der CI gemessen): der volle Wortlaut brach in den
 * Linux-Schriften bei 390 px in eine zweite Zeile, das mitwachsende Feld misst den Platzhalter
 * mit, und die Leiste riss im Handschuh-Betrieb den 50-%-Deckel (435 von 844 px; unter macOS
 * blieben 9 px Luft). „/" öffnet Typ, Felder und Bausteine gemeinsam — „Befehle" sagt dasselbe.
 */
const PLATZHALTER = 'Inhalt … ( / für Typ, Felder & Bausteine · @ für Einheit )';
const PLATZHALTER_KURZ = 'Inhalt … ( / für Befehle · @ für Einheit )';

/**
 * Eigener Wortlaut, nicht der aus `components/Erfassung.tsx`: hier gibt es keinen
 * Knopf „Speichern und nächste", auf den er sich beziehen könnte — im ETB erfasst
 * jedes Absenden in Serie. Genannt werden die Felder, weil `nurUebernahme` genau
 * drei kennt und die Auswahl sonst geraten werden müsste.
 */
const UEBERNAHME_ERKLAERUNG =
  'Von, An und Meldeweg bleiben nach dem Erfassen für den nächsten Eintrag stehen. ' +
  'Inhalt, Veranlassung und Ereigniszeit werden immer geleert.';

/**
 * Die Wiederholfelder, die ein Absenden überleben, solange „Werte behalten" an ist
 * (LFH-332/H61: eine Standard-Funkmeldung kostete 19 Tastenanschläge reines Gerüst,
 * weil Von/An/Meldeweg nach jedem Senden verworfen wurden).
 *
 * `veranlassung` und `ereigniszeit` gehören ABSICHTLICH nicht dazu — die sind je Eintrag
 * verschieden, eine stehengebliebene Ereigniszeit wäre eine falsche Tatsachenbehauptung.
 *
 * Die Funktion ist der einzige Ort, der diese Auswahl trifft; `EtbEntwurfsTabs` reicht
 * denselben Filter über die Remount-Grenze.
 */
export function nurUebernahme(
  quelle: Pick<MetadatenWerte, 'von' | 'an' | 'meldeweg'>,
): MetadatenWerte {
  return { von: quelle.von, an: quelle.an, meldeweg: quelle.meldeweg };
}

/**
 * Rollt eine waagerecht rollende Zeile so, dass `ziel` darin ganz sichtbar ist — NUR
 * waagerecht, nie das Dokument (LFH-373). Die Chip-Eingabe fokussiert mit `preventScroll`
 * (`MetaChip`); in der einzeiligen Chip-Zeile unter `md` stünde ein neuer Chip sonst hinter
 * dem rechten Rand. `scrollIntoView` wäre hier falsch: es rollte auch die Seite.
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
 * Unter `md` EINZEILIG mit waagerechtem Bildlauf (LFH-373, Vorbild `standLeisteStil` der
 * Zeitachse): gemessen kostete sonst im Handschuh-Betrieb jeder gesetzte Chip eine eigene
 * Reihe (+81 px), bei drei Chips belegte die angepinnte Leiste 578 von 844 px. Die Leistenhöhe
 * hängt damit nicht mehr an der Zahl der Felder. Rein und exportiert, prüfbar ohne Layout.
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
  // Unter `md` steht das Feld auf eigener Zeile (LFH-373): zwischen Typ-Präfix und „Erfassen"
  // blieb es gemessen auf 158 von 366 px, und die angepinnte Leiste wuchs auf 59 % des Fensters.
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
  const eigeneClientId = useRef<string>(crypto.randomUUID());
  const menuRef = useRef<SlashMenuHandle>(null);
  const feldKnopfRef = useRef<HTMLButtonElement>(null);

  const [inhalt, setInhalt] = useState(initialWerte?.inhalt ?? '');
  const [typ, setTyp] = useState<EtbTyp>(initialWerte?.typ ?? 'meldung');
  // Nur beim ersten Mount ohne Entwurf vorbelegen. Auch ein bewusst leeres
  // Entwurfsfeld gewinnt; Berichtigungen übernehmen ausschließlich das Original.
  const [metadaten, setMetadaten] = useState<MetadatenWerte>(
    () =>
      initialWerte?.metadaten ??
      (!berichtigungZu && einsatz.meine_fuehrungsstelle?.trim()
        ? { an: einsatz.meine_fuehrungsstelle.trim() }
        : {}),
  );
  const [editFeld, setEditFeld] = useState<MetaFeld | null>(null);
  // Einzeilige Chip-Zeile unter `md` (LFH-373): den gerade bearbeiteten Chip waagerecht ins
  // Bild holen. Die Eingabe hat sich beim Einhängen schon selbst fokussiert (`MetaChip`).
  // Ist kein Chip in Bearbeitung, steht die Zeile wieder am Anfang, wo „Feld" wartet.
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

  // onWerteChange in einer Ref halten: Der Autosave-Effekt darf NUR auf echte
  // Wertänderungen (inhalt/typ/metadaten) feuern — nicht, wenn der Container bei
  // jedem Render eine neue Callback-Referenz liefert. Stünde onWerteChange in den
  // Effekt-Deps, triggerte jedes Container-Re-Render (das entwurfAktualisieren
  // auslöst) den Effekt erneut → Re-Trigger-/Endlosschleife.
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
   * Klick daneben schliesst das Menü. Vorher gab es ohne Auswahl überhaupt keinen Weg
   * hinaus ausser Escape oder einem zweiten Druck auf denselben Knopf.
   *
   * Zwei Ausnahmen, beide notwendig: Das **Menü selbst**, weil seine Einträge über
   * `onMouseDown` wählen und `pointerdown` davor läuft — würde hier geschlossen, wäre
   * der Eintrag beim Klick schon weg und die Auswahl per Maus tot. Und der
   * **Feld-Knopf**, der selbst umschaltet: sonst schlösse dieser Effekt zuerst und der
   * Klick öffnete danach wieder, der Knopf könnte also nie schliessen.
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
    // Caret-Position aus dem nativen textarea über die antd-Ref.
    // Falls der Ref-Pfad nicht verfügbar ist (ältere antd-Version), Fallback auf Textende.
    const caret = textRef.current?.resizableTextArea?.textArea?.selectionStart ?? neu.length;
    aktualisiereTrigger(neu, caret);
  }

  /**
   * Entfernt NUR den „/…"-Text, der das Menü ausgelöst hat. Schliesst bewusst nicht
   * mit — das tut `waehleEintrag`. Bis zum 30.07.2026 hing das Schliessen hier mit
   * drin, hinter dem frühen Ausstieg: wer das Menü über den Feld-Knopf öffnete, hatte
   * `triggerStart === -1` (es gibt keinen Trigger-Text), und das Menü blieb nach der
   * Auswahl stehen. Es liegt absolut über der Chip-Leiste und verdeckte damit genau
   * den Chip-Editor, der gerade aufgegangen war.
   */
  function entferneTriggerText() {
    if (triggerStart < 0) return;
    const ta = textRef.current?.resizableTextArea?.textArea;
    const caret = ta?.selectionStart ?? inhalt.length;
    setInhalt(inhalt.slice(0, triggerStart) + inhalt.slice(caret));
  }

  /*
   * Während des Sendens nimmt die Erfassung keine Änderung an (LFH-117, Review C1): der Eintrag
   * ist beim Absenden gebildet, was danach an Typ, Feldern oder Baustein geändert würde, ginge
   * nicht mit und fiele nach dem Erfolg still weg. Die Bedienelemente sind gesperrt; die
   * frühen Ausstiege hier halten die Wege, die an keinem Knopf hängen (Menü, Modal, Tastatur).
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

  /** Dateiwahl: über 25 MiB wird schon hier abgewiesen, nicht erst nach dem Upload. */
  function dateienGewaehlt(liste: FileList | null) {
    const neu = [...dateien];
    const zuGross: string[] = [];
    for (const d of Array.from(liste ?? [])) {
      if (d.size > DOKUMENT_MAX_GROESSE) zuGross.push(`${d.name} ${ANHANG_ZU_GROSS}`);
      else if (!neu.includes(d)) neu.push(d);
    }
    setAnhangHinweis(zuGross.length > 0 ? zuGross.join(' · ') : null);
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
        setFortschritt({ n: i + 1, von: dateien.length });
        try {
          id = (await ladeEtbAnhangHoch(einsatz.id, d)).id;
        } catch (e) {
          setAnhangHinweis(
            `${d.name} konnte nicht hochgeladen werden: ${fehlerGrund(e)}. ` +
              'Der Eintrag ist nicht erfasst.',
          );
          return null;
        }
        hochgeladeneIds.set(d, id);
      }
      ids.push(id);
    }
    return ids;
  }

  async function absenden() {
    if (sendet || inhalt.trim() === '') return;
    // Nur der UPLOAD braucht Netz (design.md D10). Mit Dateien in der Liste wird ohne
    // Verbindung abgewiesen, ohne etwas zu leeren — ein Eintrag ohne die gewählten Dateien
    // wäre eine stille Auslassung.
    if (dateien.length > 0 && !online) {
      setAnhangHinweis(
        'Ohne Verbindung lassen sich keine Anhänge senden. ' +
          'Entferne sie, um den Text jetzt zu erfassen.',
      );
      return;
    }
    // Die Zeit gilt ab dem Absenden, nicht ab dem Ende des Uploads — sonst verschöbe ein
    // langer Upload Ereigniszeit und `erfasst_lokal_at` (Review LFH-117).
    const jetztIso = new Date().toISOString();
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
        for (const d of dateien) hochgeladeneIds.delete(d);
        throw e;
      }
      eigeneClientId.current = crypto.randomUUID();
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
   * DER PRÄFIX IST DER TYPWÄHLER (Neuentwurf S4: `/anordnung` in der Befehlszelle). Er
   * zeigt den gewählten Typ als Befehl und öffnet auf Klick die Typen als Menü — der Weg
   * für Maus und Handschuh; die Tastatur nimmt `/typ` am Zeilenanfang. Das frühere `Select`
   * unter dem Feld ist damit entfallen: zwei Wähler für denselben Wert wären zwei Stellen,
   * an denen er stehen kann. Im Berichtigungsmodus ist der Typ fest und der Präfix Text.
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
   * DIE HINWEISZEILE trägt den Tastaturvertrag — EINMAL (Nacharbeit zu LFH-335): nicht im
   * Platzhalter, nicht zusätzlich als „↵ eintragen" in der Zeile. Genannt wird nur, was es
   * gibt: `# Koordinate` des Entwurfs hat keinen Weg in den Eintrag und fehlt deshalb;
   * „⧖ Nachtrag" steht, weil `/zeit` eine zurückliegende Ereigniszeit setzt und der
   * Eintrag dann als nachgetragen erscheint.
   */
  // „Werte behalten": ab `md` rechts in der Chip-Zeile, darunter in der Hinweiszeile (Review
  // LFH-373) — in der einzeilig rollenden Chip-Zeile lag er sonst hinter dem Bildlauf.
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

  // Unter `md` die Kurzform (LFH-373): die volle Zeile brach auf dem Handschirm auf drei
  // Zeilen um und trieb die angepinnte Leiste über die Hälfte des Fensters.
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
          <PlusOutlined />
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

  // „Anhang" (LFH-117) steht bei „Feld": ab `md` hinter den Chips, darunter vorn (LFH-373).
  const anhangTeil = (
    <>
      {/* „Anhang" (LFH-117): ein antd-Knopf plus unsichtbare Dateieingabe statt antds
            `Upload` — der wickelte den Knopf in ein zweites `role="button"` mit eigenem
            Tabstopp. So bleibt EIN Bedienziel, und die Höhe kommt aus `controlHeight`. */}
      <Button
        type="dashed"
        disabled={!online || sendet}
        icon={
          <span aria-hidden="true" style={{ display: 'inline-flex' }}>
            <PaperClipOutlined />
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
      {/* Zweiter Kanal neben dem Grau (WCAG 1.4.1): der Grund steht als Satz daneben. In
            `text2`, nicht als `Typography` „secondary": dessen Ton hielt am Tag gemessen nur
            5,58 : 1 auf dem Grund der Erfassung (Boden 7, e2e `etb-anhang-pruefliste`). */}
      {!online && <span style={{ color: rollen.text2 }}>{ANHANG_OFFLINE}</span>}
    </>
  );

  return (
    // `etb-erfassung-card` trägt keine CSS-Regel mehr (den Rahmen zeichnet die
    // Schnellerfassungszeile), bleibt aber stehen: `e2e/seitenrinne.spec.ts` misst an ihr,
    // dass der Inhalt der Leiste auf der Seitenrinne steht.
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
            // „Vorschau" neben „Erfassen" statt auf eigener Zeile unter dem Feld (LFH-373): die
            // eigene Knopfzeile kostete im Handschuh-Betrieb eine volle Steuerhöhe der
            // angepinnten Leiste (gemessen 440 px = 57 % des Fükw-Fensters).
            <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
              <Button
                type="text"
                icon={
                  <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                    <EyeOutlined />
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

      {/* Chip-Leiste: die gesetzten Felder, der Weg zu weiteren — und rechts, abgesetzt,
          die EINSTELLUNG „Werte behalten". Sie steht nicht neben „Erfassen" (die Aktion
          wohnt in der Zeile darüber) und nicht zwischen Aktionen; ein Umschalter in einer
          Knopfreihe gilt als wirkungslos (30.07.2026, `components/Erfassung.tsx`). */}
      <div ref={chipZeileRef} style={chipZeileStil(istSchmal, token)}>
        {/* `flexShrink: 0` unter `md`: als Flex-Kind der einzeiligen Zeile schrumpfte die Gruppe
            sonst auf die Zeilenbreite, und die Chips brachen ihren Text IN sich um — gemessen
            wuchs die Leiste mit drei Chips von 373 auf 531 px, trotz einzeiliger Zeile. */}
        <Space wrap={!istSchmal} style={istSchmal ? { flexShrink: 0 } : undefined}>
          {/* Unter `md` steht „Feld" VORN (LFH-373): in der einzeilig rollenden Zeile rutschte
              er sonst hinter die gesetzten Chips aus dem Bild. */}
          {istSchmal && feldKnopf}
          {istSchmal && anhangTeil}
          {gesetzteFelder.map((feld) => (
            <MetaChip
              key={`${feld}-${editFeld === feld ? 'edit' : 'view'}`}
              feld={feld}
              editing={editFeld === feld}
              wert={metadaten[feld]}
              optionen={feld === 'von' || feld === 'an' ? funkrufnamen : undefined}
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
              optionen={editFeld === 'von' || editFeld === 'an' ? funkrufnamen : undefined}
              onCommit={commitFeld}
              onCancel={() => {
                setEditFeld(null);
                fokusInsFeld();
              }}
              onRemove={() => setEditFeld(null)}
              onEdit={() => {}}
            />
          )}
          {!istSchmal && feldKnopf}
          {!istSchmal && anhangTeil}
          {!berichtigungZu && typ === 'lage' && (
            <Button type="link" onClick={() => navigate(`/einsaetze/${einsatz.id}/lageberichte`)}>
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
                aria-label={`Anhang ${d.name} entfernen`}
                icon={
                  <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                    <CloseOutlined />
                  </span>
                }
                onClick={() => setzeDateien(dateien.filter((x) => x !== d))}
              />
            </li>
          ))}
        </ul>
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
