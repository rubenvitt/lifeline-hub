import { IconAuge, IconBueroklammer, IconKreuz, IconWarndreieck } from '../icons';
import { Alert, Button, Checkbox, Typography, type InputRef, type RefSelectProps } from 'antd';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { DOKUMENT_ACCEPT } from '../api/dokumente';
import { UPLOAD_MAX_GROESSE } from '../api/upload';
import { ApiError, AusgangUnbekannt, fehlerText, type UploadFortschritt } from '../api/client';
import { ETB_ANHAENGE_MAX, ladeEtbAnhangHoch, type NeuerEintrag } from '../api/etb';
import { formatGroesse } from '../karten/formatGroesse';
import { useOnline } from '../offline/useOnline';
import type { EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige, EtbTyp } from '../api/types';
import { etbTyp, etbTypFarbe } from '../theme/statusFarben';
import type { BausteinFelder } from './bausteinEinsetzen';
import MarkdownEditor, { type TextAreaRef } from '../components/MarkdownEditor';
import { Zeichenzaehler } from '../components/zeichenGrenze';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import UploadFortschrittAnzeige from '../components/UploadFortschritt';
import { weiter } from '../components/useUploadFortschritt';
import { Schnellerfassungszeile, monoStil, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import EtbFeldzeile, { FEHLT, TypKnopf, type ParteiRef } from './EtbFeldzeile';
import { useFunkrufnamen } from './funkrufnamen';
import { anVorbelegung } from '../fuehrung/funktionsOptionenKern';
import {
  KONTEXT_FUNKRUFNAME,
  merkeZuletzt,
  useFunkrufnamenQuellen,
} from '../stammdaten/vorschlagsquellen';
import { useFunktionsVorschlaege } from '../fuehrung/useFunktionsVorschlaege';
import SlashMenu, { type SlashMenuHandle } from './SlashMenu';
import RufnameAbfrage from './RufnameAbfrage';
import { auchInMeldungseingang, ausStandard, wirksameMetadaten } from './standardRufname';
import type { StandardRufnameZugriff } from './useStandardRufname';
import BausteinPlatzhalterModal from './BausteinPlatzhalterModal';
import {
  amZeilenanfang,
  baueEintrag,
  einheitAusSchluessel,
  erkenneAtTrigger,
  erkenneSlashTrigger,
  erkenneTypBefehl,
  fehlendeSeiten,
  filterAtEintraege,
  hatFormatierung,
  METADATEN_FELDER,
  nachtragHinweis,
  nachtragMinuten,
  type MetadatenWerte,
  type MetaFeld,
  type SlashEintrag,
  laengenVerstoss,
  erkenneZeitBefehl,
  zukunftsVerstoss,
} from './schnellerfassungModell';
import type { EntwurfWerte } from './entwuerfe/entwurfModell';
import { berichtigungTitel } from './zeitachseModell';
import { neueClientId } from '../offline/clientId';
import { serverJetzt } from '../offline/serveruhr';
import { useZeitEingabe } from '../anzeige/ZeitpunktEingabe';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { useMinutenTakt } from '../components/useMinutenTakt';
import { lageberichtePfad } from '../routing/deeplinks';
import { istSpiegel } from '../einsatz/schreibrecht';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { MODUL_MELDUNGEN_GESPERRT } from '../components/nurAnsicht';

interface Props {
  erfassen: (eintrag: NeuerEintrag) => Promise<void>;
  berichtigungZu: EtbEintragAnzeige | null;
  /**
   * Nummer des Grundeintrags, wenn `berichtigungZu` selbst eine Berichtigung ist und er geladen
   * ist (LLH-1099, Kette im Titel). Ohne sie nennt der Titel „einen älteren Eintrag“.
   */
  berichtigungGrundNr?: number | null;
  onBerichtigungAbbrechen: () => void;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
  /**
   * Standard-Rufname der angemeldeten Person (LFH-894), vom Aufrufer über `useStandardRufname`
   * geführt: die Seite hält ihn einmal, Entwurfs-Reiter und Berichtigung teilen ihn.
   */
  rufname: StandardRufnameZugriff;
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
  /**
   * Eingeklappt (Handschirm, LFH-955 D4; Change `kwc2yszv-etb-neuentwurf`, Aufgabe 4.1): eine Zeile
   * aus Typ-Knopf und Inhalt. Feldzeile, Fußzeile mit „Erfassen“ und Rufnamenzeile entfallen. Ob,
   * entscheiden `EtbPage` (Fokus) und `EtbEntwurfsTabs` (leerer Entwurf); das Feld behält dabei
   * seinen Platz im Baum.
   */
  eingeklappt?: boolean;
  /**
   * Fokus beim Mount. Aus unter `md`: dort klappte er die Leiste beim Laden auf und öffnete die
   * Bildschirmtastatur über der Zeitachse.
   */
  startFokus?: boolean;
  /**
   * „+ weiterer Entwurf“ in der Fußzeile (Spec „Entwurfsreiter und Vorschau nur bei Bedarf“):
   * `EtbEntwurfsTabs` legt damit einen Entwurf an. Fehlt er (Berichtigung), fehlt der Knopf.
   */
  onWeitererEntwurf?: () => void;
}

/** Sendezustand einer Erfassung: läuft ein Versand, wie weit der Upload ist, welcher Grund steht. */
export interface Versand {
  sendet: boolean;
  /** Datei `n` von `von`, mit dem Stand ihrer Übertragung (LFH-878). */
  fortschritt: { n: number; von: number; stand: UploadFortschritt } | null;
  /** Hinweis an der Dateiliste — bleibt stehen bis zur nächsten Wahl oder zum nächsten Absenden. */
  hinweis: string | null;
  /**
   * Grund, aus dem der Server den Eintrag abgelehnt hat (LFH-1077, `frontend/AGENTS.md`, „Rückwege
   * und Fehler“). Eigenes Feld: eine Dateiwahl räumt den Dateihinweis, nicht diesen; er bleibt
   * bis zum nächsten Absenden.
   */
  ablehnung: string | null;
}

export const VERSAND_RUHE: Versand = {
  sendet: false,
  fortschritt: null,
  hinweis: null,
  ablehnung: null,
};

/**
 * Welche Datei schon oben liegt: nach einem Teilausfall lädt der nächste Versuch nur den
 * Rest. Auf Modulebene, weil der Tabwechsel die Schnellerfassung neu montiert; ein `WeakMap`
 * nach `File` hält keine Datei fest, die niemand mehr kennt. Lehnt der Server fachlich ab,
 * werden die Zuordnungen dieses Versuchs verworfen, weil die ID die Ursache sein könnte.
 */
const hochgeladeneIds = new WeakMap<File, number>();

const ANHANG_ZU_GROSS = `ist zu groß (${UPLOAD_MAX_GROESSE / 1024 / 1024} MiB erlaubt)`;
/**
 * Absenden ohne Netz mit Dateien in der Liste (LFH-1078): Zustand statt Anleitung; den Ausweg
 * trägt der Knopf „Anhänge entfernen“ am Hinweis, nicht ein Satz.
 */
const ANHANG_OFFLINE_SENDEN = 'Offline – Anhänge nicht sendbar';

/**
 * Dieselbe Datei, neu gewählt: jede Dateiwahl liefert NEUE `File`-Objekte, ein
 * Identitätsvergleich griffe nie. Name, Größe und Änderungszeit trennen zwei Dateien
 * hinreichend — ein Foto zweimal am Eintrag ließe sich wegen der Unveränderlichkeit nicht
 * mehr entfernen.
 */
function gleicheDatei(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

/** Ein Feld, in dem getippt wird — der Startfokus nimmt es niemandem weg (LFH-1089). */
function istEingabefeld(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable;
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

/**
 * Platzhalter: nur, WAS in das Feld gehört (LFH-1078, `frontend/AGENTS.md`, „Texte: zeigen statt
 * erklären“). Typ und Felder zeigen die Feldzeile, die Sendetaste die Kappe an
 * „Erfassen“; ein Tastenweg im Platzhalter wäre ein Erklärsatz. Eine Form für jede Breite: kurz
 * genug, dass das mitwachsende Feld bei 390 px nicht umbricht (LFH-373).
 */
const PLATZHALTER = 'Inhalt …';

/**
 * Tastenkürzel von „Erfassen“ (LFH-955, design.md D1): mit grobem Zeiger sendet Return nicht,
 * dort gilt nur Strg/⌘+Enter der Hardware-Tastatur am Tablet.
 */
const KUERZEL_FEIN = 'Enter Control+Enter Meta+Enter';
const KUERZEL_GROB = 'Control+Enter Meta+Enter';

/**
 * Die Wiederholfelder, die ein Absenden überleben, solange „Werte behalten" an ist
 * (Von/An/Meldeweg sind das Gerüst einer Funkmeldung). Den Eintragstyp behält der Schalter
 * ebenfalls (LLH-1112); er ist kein Metadatum und geht eigens mit (`entwurfSchliessen`).
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
 * Die Fußzeile unter dem Inhalt (Spec „Einstellungen in der Fußzeile der Erfassung“): links
 * „Auch in den Meldungseingang“ und „Werte behalten“ samt Hinweisen, rechts die Textknöpfe.
 *
 * Unter `md` EINZEILIG mit waagerechtem Bildlauf: sonst kostete jeder Knopf im Handschuh-Betrieb
 * eine eigene Reihe, und die angepinnte Leiste wüchse (LFH-373). Rein und exportiert, prüfbar
 * ohne Layout.
 */
export function fusszeileStil(
  schmal: boolean,
  token: { marginXS: number; marginSM: number },
): CSSProperties {
  return {
    display: 'flex',
    flexWrap: schmal ? 'nowrap' : 'wrap',
    alignItems: 'center',
    columnGap: token.marginSM,
    rowGap: token.marginXS,
    marginTop: token.marginXS,
    fontSize: 12,
    ...(schmal ? { overflowX: 'auto', minWidth: 0 } : {}),
  };
}

export default function Schnellerfassung({
  erfassen,
  berichtigungZu,
  berichtigungGrundNr,
  onBerichtigungAbbrechen,
  bausteine,
  einsatz,
  rufname,
  initialWerte,
  onWerteChange,
  werteBehalten = false,
  onWerteBehaltenChange,
  dateien: dateienVonAussen,
  onDateienChange,
  clientId,
  versand: versandVonAussen,
  onVersandChange,
  eingeklappt = false,
  startFokus = true,
  onWeitererEntwurf,
}: Props) {
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  const online = useOnline();
  // Unter `md` steht das Feld auf eigener Zeile: zwischen Typ-Präfix und „Erfassen" bliebe es
  // zu schmal, und die angepinnte Leiste wüchse über die Hälfte des Fensters (LFH-373).
  // Die Zeigerart entscheidet über den Enter-Vertrag (LFH-955), die Breite nur über das Layout.
  const { istSchmal, istBeruehrung, istNiedrig, screens, abBreite } = useViewport();
  // Niedriges Fenster ab `md`: Felder und Fußzeile in einer rollenden Zeile (design.md D9).
  const einzeilig = istNiedrig && !istSchmal;
  const [vorschauGewaehlt, setVorschauGewaehlt] = useState(false);
  const textRef = useRef<TextAreaRef>(null);
  const dateiEingabe = useRef<HTMLInputElement>(null);
  const [eigeneDateien, setEigeneDateien] = useState<File[]>([]);
  const dateien = dateienVonAussen ?? eigeneDateien;
  function setzeDateien(neu: File[]) {
    if (onDateienChange) onDateienChange(neu);
    else setEigeneDateien(neu);
  }
  const [eigenerVersand, setEigenerVersand] = useState<Versand>(VERSAND_RUHE);
  const {
    sendet,
    fortschritt,
    hinweis: versandHinweis,
    ablehnung,
  } = versandVonAussen ?? eigenerVersand;
  /** Funktional gemergt: der laufende Versand schreibt aus einer alten Closure heraus. */
  function aendereVersand(aenderung: Partial<Versand>) {
    if (onVersandChange) onVersandChange(aenderung);
    else setEigenerVersand((v) => ({ ...v, ...aenderung }));
  }
  const setAnhangHinweis = (hinweis: string | null) => aendereVersand({ hinweis });
  /**
   * Der Offline-Hinweis gilt nur, solange das Netz fehlt: kommt es zurück, bietet er nicht
   * weiter an, alle Anhänge zu verwerfen (LFH-1078). Abgeleitet im Rendern, kein Effekt.
   */
  const anhangHinweis = versandHinweis === ANHANG_OFFLINE_SENDEN && online ? null : versandHinweis;
  const setFortschritt = (f: Versand['fortschritt']) => aendereVersand({ fortschritt: f });
  /** Eigener Schlüssel ohne Aufrufer-id: stabil über Fehlversuche, neu nach jedem Erfolg. */
  const eigeneClientId = useRef<string>(neueClientId());
  const menuRef = useRef<SlashMenuHandle>(null);
  // Die Felder der Feldzeile, für Fokus (erstes leeres Pflichtfeld, Grund am Feld) und `/`-Menü.
  const zeitRef = useRef<InputRef>(null);
  const vonRef = useRef<ParteiRef>(null);
  const anRef = useRef<ParteiRef>(null);
  const meldewegRef = useRef<RefSelectProps>(null);
  const veranlassungRef = useRef<InputRef>(null);
  /** „+ Veranlassung“ hat das Feld in die Zeile geholt (auch ohne Wert, bis es leer verlassen wird). */
  const [veranlassungOffen, setVeranlassungOffen] = useState(false);

  const [inhalt, setInhalt] = useState(initialWerte?.inhalt ?? '');
  const [typ, setTyp] = useState<EtbTyp>(initialWerte?.typ ?? 'meldung');
  /**
   * Handwahl des Schalters „Auch in den Meldungseingang“ (LLH-1037; Change
   * `kwc2yszv-etb-neuentwurf`, design.md D4), gespeichert als `nur_protokollieren`: `true` = von
   * Hand aus, `false` = von Hand an, `undefined` = Vorgabe (`auchInMeldungseingang`). Lebt im
   * Entwurf und springt nach jedem Erfassen auf die Vorgabe zurück, auch mit „Werte behalten“.
   */
  const [nurProtokollieren, setNurProtokollieren] = useState<boolean | undefined>(
    initialWerte?.nurProtokollieren,
  );
  // `metadaten` hält NUR, was die Person ausdrücklich gesetzt hat. Von/An aus dem
  // Standard-Rufnamen kommen erst über `wirksam` hinzu (LFH-894, design.md D2): so überlebt der
  // Standard das Leeren nach dem Absenden, und kein Entwurf trägt einen veralteten Wert. Die
  // Vorrangregel (Führungsstelle → erstes Sachgebiet) belegt nichts mehr vor, sie ist nur noch
  // der erste Vorschlag der Rufname-Abfrage (D3).
  // Eine Berichtigung trägt Von, An und Meldeweg des berichtigten Eintrags (Spec
  // `etb-absender-empfaenger`, „Vorbelegung neuer Einträge“), ausdrücklich gesetzt.
  const [metadaten, setMetadaten] = useState<MetadatenWerte>(
    () =>
      initialWerte?.metadaten ??
      (berichtigungZu
        ? {
            von: berichtigungZu.von ?? undefined,
            an: berichtigungZu.an ?? undefined,
            meldeweg: berichtigungZu.meldeweg ?? undefined,
          }
        : {}),
  );
  // Die Vorgabe für Von und An hängt am Typ (Change `kwc2yszv-etb-neuentwurf`, design.md D3); die
  // Berichtigung hat keine, sie trägt die Werte des berichtigten Eintrags.
  const vorgabeTyp: EtbTyp = berichtigungZu ? 'berichtigung' : typ;
  const wirksam = wirksameMetadaten(metadaten, rufname.standard, vorgabeTyp);
  /** Abfragezeile zum Ändern eines gesetzten Standards offen (ohne Standard steht sie immer). */
  const [rufnameAendern, setRufnameAendern] = useState(false);
  /** Grund, warum ein Absenden an der Von/An-Pflicht scheiterte (D7); geht beim nächsten Versuch. */
  const [pflicht, setPflicht] = useState<('von' | 'an')[]>([]);
  // Ein Pflichtgrund steht nur, solange die Seite wirklich fehlt: eine Vorgabe nach Typwechsel oder
  // ein `@` füllen sie ohne `setzeFeld` (Review E5).
  const fehltJetzt = fehlendeSeiten(wirksam);
  const pflichtSichtbar = pflicht.filter((seite) => fehltJetzt.includes(seite));
  /** Kennungen der Gründe in der Fußzeile; die Felder verweisen per `aria-describedby` darauf. */
  const pflichtGrundId = useId();
  const zeitGrundId = useId();
  /** Kennung des Kurzgrunds neben „Anhang“ (`aria-describedby`, LFH-1078). */
  const anhangGrundId = useId();
  /** Kennung des Grunds neben einem gesperrten „Nur protokollieren“ (LLH-1037). */
  const protokollGrundId = useId();
  /** Grund, warum ein Absenden an einer Zeichengrenze scheiterte (LFH-937, D8); wie oben. */
  const [laengenHinweis, setLaengenHinweis] = useState<string | null>(null);
  /** Unlesbare Angabe hinter `/zeit` (LLH-1088): der Grund steht in der Hinweiszeile. */
  const [zeitBefehlGrund, setZeitBefehlGrund] = useState<string | null>(null);
  /** Ereigniszeit in der Zukunft beim Absenden (LLH-1088): der Grund steht am Zeit-Chip. */
  const [zukunftsGrund, setZukunftsGrund] = useState<string | null>(null);
  const { zone: anzeigeZone } = useZeitEingabe();
  const { konventionen } = useAnzeigeKonventionen();
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
  /**
   * Einklappen schließt das Menü: es hängt an der Leiste, die eingeklappt keine Feldzeile hat.
   * Abgeleitet im Rendern, kein Effekt.
   */
  if (eingeklappt && menuOffen) setMenuOffen(false);

  const [bausteinOffen, setBausteinOffen] = useState<EtbBaustein | null>(null);

  // Funkrufnamen disponierter Fahrzeuge/Einheiten als Vorschläge für von/an.
  // Freitext bleibt Fallback (AC#1).
  const funkrufnamen = useFunkrufnamen(einsatz.id);
  const funktionen = useFunktionsVorschlaege(einsatz.id);
  // Ohne Zugriff auf Lageberichte entfällt der Sprung dorthin (LFH-888, `frontend/AGENTS.md`).
  const sprungSperre = useSprungSperre(einsatz.id);
  const lageberichteGesperrt = sprungSperre('lageberichte');
  // Ohne Freigabe der Meldungen wird nur protokolliert (LLH-1037, design.md D8): Einsatz-Schreibrecht
  // hat, wer hier erfasst; es fehlt allein das Modul. Unbekannt heißt offen, der Server prüft.
  const meldungenGesperrt = sprungSperre('meldungen');
  // „Von“/„An“ über das Vorschlagsfeld (LLH-1144, Spec `stammdaten-feld`): im Einsatz Funkrufnamen
  // plus Sachgebiete (LFH-545/549), dazu Stammdaten und „Zuletzt verwendet“. Ohne „In Stammdaten
  // übernehmen“: die Leiste hat dafür kein Höhenbudget (LFH-955, design.md D4).
  const vonAnQuellen = useFunkrufnamenQuellen({
    einsatzId: einsatz.id,
    funktionen,
    uebernahme: false,
  });

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
    onWerteChangeRef.current?.({ inhalt, typ, metadaten, nurProtokollieren });
  }, [inhalt, typ, metadaten, nurProtokollieren]);

  // Fokus beim Mount. State-Reset bei Tab-/Modus-Wechsel erfolgt über key-basiertes
  // Remounting im Container (EtbEntwurfsTabs / EtbPage-Berichtigung).
  // Einmal, sobald die Breite bekannt ist: auf dem ersten Render gilt sie als breit
  // (`useViewport`), und der Wechsel in die gestapelte Form montierte das Feld neu — ein früher
  // Fokus ginge verloren, und `startFokus` (unter `md` aus) stünde noch auf dem breiten Wert.
  // Danach fokussiert kein Aufklappen von selbst.
  // Kein Fokusraub (LFH-1089): die Leiste montiert erst nach dem Laden der Entwürfe. Wer bis dahin
  // schon in einem Eingabefeld tippt (Volltextsuche), behält es, sonst landeten die übrigen
  // Zeichen im Entwurf. Ein fokussierter Knopf oder Link (Sprung über die Navigation) zählt nicht.
  // Ziel ist das erste leere Pflichtfeld der Feldzeile, sonst der Inhalt (Spec „Fokus im ersten
  // leeren Pflichtfeld“); dafür wartet der Fokus auch auf den gelesenen Standard (die Vorgabe).
  const breiteBekannt = Object.keys(screens).length > 0;
  const startFokusErledigt = useRef(false);
  useEffect(() => {
    const fachEntschieden = rufname.entschieden ?? rufname.geladen;
    if (!breiteBekannt || !fachEntschieden || startFokusErledigt.current) return;
    startFokusErledigt.current = true;
    if (startFokus && !istEingabefeld(document.activeElement)) fokusStart(true);
    // `fokusStart` liest den Stand dieses Renders; er ist hier gewollt nur einmal gefragt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breiteBekannt, startFokus, rufname.geladen, rufname.entschieden]);

  /** Nach einem Erfolg ohne Remount (Berichtigung, Einzelaufrufer): Fokus nach derselben Regel. */
  const [fokusNachErfassen, setFokusNachErfassen] = useState(0);
  useEffect(() => {
    if (fokusNachErfassen > 0) fokusStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokusNachErfassen]);

  /**
   * Klick daneben schließt das Menü. Ausnahme ist das **Menü selbst**, weil seine Einträge über
   * `onMouseDown` wählen und `pointerdown` davor läuft — sonst wäre die Mausauswahl tot.
   */
  useEffect(() => {
    if (!menuOffen) return;
    function beiZeigerAb(ereignis: PointerEvent) {
      const ziel = ereignis.target;
      const el = ziel instanceof Element ? ziel : ((ziel as Node | null)?.parentElement ?? null);
      if (el?.closest('[data-slash-menu]')) return;
      setMenuOffen(false);
    }
    document.addEventListener('pointerdown', beiZeigerAb);
    return () => document.removeEventListener('pointerdown', beiZeigerAb);
  }, [menuOffen]);

  const gesetzteFelder = METADATEN_FELDER.map((d) => d.feld).filter((f) => wirksam[f] != null);
  // Die Abfrage steht nur, wenn das Fach gelesen ist — eine Zeile, die nach der Antwort wieder
  // verschwände, wäre ein Sprung unter dem Cursor. In der Berichtigung gilt der vorhandene
  // Standard, gefragt wird dort nicht.
  const rufnameAbfrageOffen =
    !berichtigungZu && rufname.geladen && (rufname.standard == null || rufnameAendern);

  // Der Schalter erscheint nur ausserhalb der Berichtigung und nur, wenn ein Aufrufer den
  // Zustand führt. Ohne sichtbaren Schalter wird auch nichts übernommen — eine unsichtbar
  // wirkende Übernahme wäre für den Erfasser nicht erklärbar.
  const zeigeSchalter = !berichtigungZu && onWerteBehaltenChange != null;
  const uebernahmeAktiv = zeigeSchalter && werteBehalten;
  /** Typ Meldung oder Lage, nicht in der Berichtigung: nur dann gibt es den Weg in den Eingang. */
  const eingangMoeglich = !berichtigungZu && (typ === 'meldung' || typ === 'lage');
  /** Geht dieser Eintrag in den Meldungseingang? Der Client sendet es immer ausdrücklich. */
  const inMeldungseingang =
    eingangMoeglich &&
    !meldungenGesperrt &&
    auchInMeldungseingang(nurProtokollieren, wirksam, rufname.standard);

  function fokusInsFeld() {
    requestAnimationFrame(() => textRef.current?.focus());
  }

  /** Fokus in ein Feld der Feldzeile (`/`-Menü, Pflicht- und Zeitgrund). */
  function fokusFeld(feld: MetaFeld, nurOhneFremdenFokus = false) {
    if (feld === 'veranlassung') setVeranlassungOffen(true);
    requestAnimationFrame(() => {
      // Startfokus (LFH-1089): wer im selben Bild in ein anderes Feld gewechselt ist, behält es.
      if (nurOhneFremdenFokus && istEingabefeld(document.activeElement)) return;
      const ziel =
        feld === 'ereigniszeit'
          ? zeitRef.current
          : feld === 'von'
            ? vonRef.current
            : feld === 'an'
              ? anRef.current
              : feld === 'meldeweg'
                ? meldewegRef.current
                : veranlassungRef.current;
      ziel?.focus();
    });
  }

  /** Erstes leeres Pflichtfeld, sonst der Inhalt (Spec „Fokus im ersten leeren Pflichtfeld“). */
  function fokusStart(nurOhneFremdenFokus = false) {
    const fehlt = berichtigungZu ? undefined : fehlendeSeiten(wirksam)[0];
    if (fehlt) fokusFeld(fehlt, nurOhneFremdenFokus);
    else textRef.current?.focus();
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
    let text = neu;
    if (befehl) {
      setTyp(befehl.typ);
      text = befehl.rest;
    }
    // Danach `/zeit 1420 ` (LLH-1088): setzt die Ereigniszeit, der Rest bleibt Inhalt. Unlesbar
    // bleibt der Text stehen, und die Hinweiszeile nennt den Grund. Ausgelöst wird nur, wenn das
    // Leerzeichen hinter der Angabe eben getippt (Cursor genau dort) oder alles eingefügt wurde:
    // wer in „/zeit 2590 Pumpe“ eine Ziffer löscht, meint nicht 02:59.
    const caretRoh = textRef.current?.resizableTextArea?.textArea?.selectionStart ?? neu.length;
    const caretImRest = caretRoh - (neu.length - text.length);
    const zeit = erkenneZeitBefehl(text, { zone: anzeigeZone, jetzt: serverJetzt() });
    const ausloesen =
      zeit != null && (befehl != null || caretImRest === zeit.ende || !inhalt.startsWith('/zeit'));
    if (zeit?.ok && ausloesen) {
      setMetadaten((m) => ({ ...m, ereigniszeit: zeit.zeitpunkt }));
      setZukunftsGrund(null);
      text = zeit.rest;
    }
    setZeitBefehlGrund(zeit && !zeit.ok ? zeit.grund : null);
    if (befehl || (zeit?.ok && ausloesen)) {
      setInhalt(text);
      aktualisiereTrigger(text, text.length);
      return;
    }
    setInhalt(neu);
    // Caret-Position aus dem nativen textarea über die antd-Ref, sonst Textende.
    const caret = textRef.current?.resizableTextArea?.textArea?.selectionStart ?? neu.length;
    aktualisiereTrigger(neu, caret);
  }

  /**
   * Entfernt NUR den „/…"-Text, der das Menü ausgelöst hat, und schließt bewusst nicht mit —
   * das tut `waehleEintrag`.
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
      fokusFeld(e.key as MetaFeld);
    } else {
      const b = bausteine.find((x) => String(x.id) === e.key) ?? null;
      setBausteinOffen(b);
    }
  }

  /**
   * Ein Feld der Feldzeile hat einen Wert übernommen; er gilt sofort (Spec „Feste Felder der
   * Erfassung“). Während des Sendens nimmt die Erfassung nichts an (LFH-748). Ein übernommenes
   * Von/An merkt sich das Gerät für „Zuletzt verwendet“ (LLH-1144, D5).
   */
  function setzeFeld<F extends keyof MetadatenWerte>(feld: F, wert: MetadatenWerte[F]) {
    if (sendet) return;
    if (feld === 'ereigniszeit') setZukunftsGrund(null);
    if ((feld === 'von' || feld === 'an') && typeof wert === 'string') {
      merkeZuletzt(KONTEXT_FUNKRUFNAME, wert);
      setPflicht((p) => p.filter((x) => x !== feld));
    }
    setMetadaten((m) => ({ ...m, [feld]: wert }));
  }

  function bausteinEinsetzen(felder: BausteinFelder) {
    if (sendet) return;
    setInhalt(felder.inhalt);
    setZeitBefehlGrund(null);
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
    // Grober Zeiger: nur Strg/⌘+Enter sendet, Return bricht um (LFH-955, design.md D1).
    const einzeilerSendet = !istBeruehrung && inhalt.trim() !== '' && !inhalt.includes('\n');
    const istSendeTaste =
      e.key === 'Enter' &&
      !e.repeat &&
      !e.shiftKey &&
      !e.altKey &&
      (e.ctrlKey || e.metaKey || einzeilerSendet);
    if (istSendeTaste) {
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
    // Von/An-Pflicht (LFH-894, D7): VOR Upload und Warteschlange. Text, Felder und Anhänge
    // bleiben stehen; der Grund steht am Feld, der Fokus geht dorthin (Spec „Pflicht im Client“).
    const fehlen = fehlendeSeiten(wirksam);
    setPflicht(fehlen);
    if (fehlen.length > 0) {
      fokusFeld(fehlen[0]);
      return;
    }
    // Zeichengrenzen des Servers (LFH-937, design.md D8): ebenfalls VOR Upload und Warteschlange.
    // Das Feld kürzt nie (Zähler „zu lang“), und ein Baustein oder Slash-Befehl setzt Text von außen;
    // ein zu langer Eintrag läge sonst bis zum Abgleich in der Offline-Queue und käme abgelehnt
    // zurück. Der Text bleibt im Feld.
    const zuLang = laengenVerstoss(inhalt, wirksam);
    setLaengenHinweis(zuLang);
    if (zuLang) return;
    // Ereigniszeit in der Zukunft (LLH-1088, Spec „Keine Ereigniszeit in der Zukunft“): ebenso
    // VOR Upload und Warteschlange, nach der Serveruhr. Der Grund steht am Feld Zeit, der Fokus
    // geht dorthin; Text und Felder bleiben.
    const zukunft = zukunftsVerstoss(wirksam, serverJetzt());
    setZukunftsGrund(zukunft);
    if (zukunft) {
      fokusFeld('ereigniszeit');
      return;
    }
    // Nur der UPLOAD braucht Netz. Mit Dateien in der Liste wird ohne Verbindung abgewiesen, ohne
    // etwas zu leeren — ein Eintrag ohne die gewählten Dateien wäre eine stille Auslassung.
    // Über der Höchstzahl gar nicht erst hochladen: das Erfassen scheiterte mit 400, und die
    // Dateien lägen bis zum Aufräumlauf verwaist oben.
    if (dateien.length > ETB_ANHAENGE_MAX) {
      setAnhangHinweis(`Zu viele Anhänge: ${dateien.length}/${ETB_ANHAENGE_MAX}`);
      return;
    }
    if (dateien.length > 0 && !online) {
      setAnhangHinweis(ANHANG_OFFLINE_SENDEN);
      return;
    }
    // Die Zeit gilt ab dem Absenden, nicht ab dem Ende des Uploads — sonst verschöbe ein langer
    // Upload Ereigniszeit und `erfasst_lokal_at`. Sie gilt nach der Serveruhr, soweit der Versatz
    // bekannt ist: eine vorgehende Geräteuhr datierte den Eintrag sonst zu spät (LFH-895,
    // `openspec/changes/archive/2026-10-04-lfh-895-ereigniszeit-serveruhr/design.md`, D1/D2).
    const jetztIso = serverJetzt().toISOString();
    aendereVersand({ sendet: true, hinweis: null, ablehnung: null });
    try {
      const anhangIds = await ladeAnhaengeHoch();
      setFortschritt(null);
      if (anhangIds == null) return;
      const eintrag: NeuerEintrag = {
        ...baueEintrag({
          inhalt,
          typ,
          metadaten: wirksam,
          berichtigungZuId: berichtigungZu ? berichtigungZu.id : undefined,
          jetztIso,
        }),
        client_id: clientId ?? eigeneClientId.current,
        ...(anhangIds.length > 0 ? { anhang_ids: anhangIds } : {}),
        in_meldungseingang: inMeldungseingang,
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
        // Einsatz ist abgeschlossen. Der nächste Versuch nimmt einen neuen Schlüssel; mit
        // Aufrufer-id gibt `EtbEntwurfsTabs` dem Entwurf eine neue.
        if (e instanceof ApiError && e.status === 409) eigeneClientId.current = neueClientId();
        // Jede Ablehnung: der Wortlaut bleibt, der Grund steht AN der Erfassung, kein Toast
        // (LFH-1077). Netzfehler kommen hier nicht an, die nimmt die Offline-Queue.
        aendereVersand({ ablehnung: fehlerText(e, 'Senden fehlgeschlagen') });
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
      // Der Typ bleibt mit „Werte behalten“ stehen (LLH-1112), sonst beginnt es als Meldung.
      if (!uebernahmeAktiv) setTyp('meldung');
      // „Auch in den Meldungseingang“ springt immer auf die Vorgabe zurück, auch mit „Werte
      // behalten“ (LLH-1027 D2): ein vergessener Schalter ließe sonst eine Serie am
      // Meldungseingang vorbeilaufen.
      setNurProtokollieren(undefined);
      setVeranlassungOffen(false);
      setMenuOffen(false);
      if (berichtigungZu) onBerichtigungAbbrechen();
      setFokusNachErfassen((n) => n + 1);
    } catch {
      // Abgelehnt: der Grund steht schon an der Erfassung (`ablehnung`), der Wortlaut bleibt im
      // Feld (Erfassungs-Norm, `onErfassen` muss ablehnen). Weiterwerfen hieße hier nur eine
      // unbehandelte Zurückweisung aus `void absenden()`.
    } finally {
      aendereVersand({ sendet: false, fortschritt: null });
    }
  }

  /*
   * TYP UND KANTE (LLH-1112, Change `kwc2yszv-etb-neuentwurf`): ab `md` wählt die Segmentleiste der
   * Feldzeile den Typ, unter `md` der Knopf vor dem Inhalt (er steht auch eingeklappt). Die Zeile
   * des Inhalts trägt die Kante des Typs. Im Berichtigungsmodus ist der Typ fest; das Wort steht
   * dann vor dem Inhalt.
   */
  const anzeigeTyp: EtbTyp = berichtigungZu ? 'berichtigung' : typ;
  const typFarbe = etbTypFarbe(anzeigeTyp, token);
  const typWaehlen = (t: EtbTyp) => {
    if (sendet) return;
    setTyp(t);
  };
  const praefix = berichtigungZu ? (
    <span style={{ color: typFarbe.wort, fontSize: 13 }}>{etbTyp.berichtigung.label}</span>
  ) : istSchmal ? (
    <TypKnopf typ={typ} gesperrt={sendet} onTyp={typWaehlen} />
  ) : undefined;

  /*
   * NACHTRAG (Spec „Abweichende Ereigniszeit bleibt sichtbar“): eine Ereigniszeit ab einer Minute
   * vor „jetzt“ steht in der Achtungsrolle, die Fußzeile nennt den Abstand, der Knopf die Zeit.
   * `useMinutenTakt` hält beides mit der Uhr aktuell.
   */
  useMinutenTakt();
  const jetzt = serverJetzt();
  // Eine Zeit in der Zukunft zeigt ihren Grund schon vor dem Senden (Review E6); `zukunftsGrund`
  // bleibt der Stand des letzten Sendeversuchs.
  const zukunftJetzt = zukunftsGrund ?? zukunftsVerstoss(metadaten, jetzt);
  const nachtragMin = zukunftJetzt ? null : nachtragMinuten(metadaten.ereigniszeit, jetzt);
  // Heute nur die Uhrzeit, sonst mit Tag, in der Darstellung der Person (`anzeige/zeitDarstellung.ts`).
  const zeitAmKnopf =
    nachtragMin != null ? zeitKurz(metadaten.ereigniszeit, konventionen, jetzt) : null;
  const knopfText = berichtigungZu
    ? 'Berichtigung erfassen'
    : zeitAmKnopf
      ? `Erfassen als ${zeitAmKnopf}`
      : 'Erfassen';

  // „Vorschau“ nur, wenn der Inhalt Formatierung trägt (Spec „Entwurfsreiter und Vorschau nur bei
  // Bedarf“); ohne Formatierung schließt sie von selbst.
  const formatiert = hatFormatierung(inhalt);
  const vorschauOffen = vorschauGewaehlt && formatiert;

  // „Werte behalten“ (Fußzeile, links). Gesperrt beim Senden: der laufende Versand hat die
  // Übernahme schon gelesen. Ohne Kästchen-Boden unter `md` (`antdKaestchen`, LFH-907): im
  // Handschuh-Betrieb höbe er die einzeilige Fußzeile auf dem Handschirm über das Höhenbudget.
  const schalter = zeigeSchalter ? (
    <Checkbox
      checked={werteBehalten}
      disabled={sendet}
      onChange={(e) => onWerteBehaltenChange?.(e.target.checked)}
      style={istSchmal ? { minHeight: 0, flexShrink: 0 } : { flexShrink: 0 }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Werte behalten
      </Typography.Text>
    </Checkbox>
  ) : null;

  // „Auch in den Meldungseingang“ (LLH-1037; Change `kwc2yszv-etb-neuentwurf`, D4): nur bei Meldung
  // und Lage, Vorgabe an außer bei einem eigenen Vermerk. Ohne Freigabe der Meldungen aus und
  // gesperrt, der Grund steht daneben (Wort statt Satz, LFH-1078).
  const protokollSchalter = eingangMoeglich ? (
    <span
      data-lfh="etb-einstellungen"
      style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS, flexShrink: 0 }}
    >
      <Checkbox
        checked={inMeldungseingang}
        disabled={sendet || meldungenGesperrt}
        aria-describedby={meldungenGesperrt ? protokollGrundId : undefined}
        onChange={(e) => setNurProtokollieren(!e.target.checked)}
        style={istSchmal ? { minHeight: 0 } : undefined}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Auch in den Meldungseingang
        </Typography.Text>
      </Checkbox>
      {meldungenGesperrt && (
        <span
          id={protokollGrundId}
          data-lfh="etb-protokoll-grund"
          style={{ color: rollen.text2, whiteSpace: 'nowrap' }}
        >
          {MODUL_MELDUNGEN_GESPERRT}
        </span>
      )}
    </span>
  ) : null;

  /** Ein Grund in der Fußzeile: Zeichen und Wort neben der Farbe (WCAG 1.4.1). */
  const grundStil = (farbe: string): CSSProperties => ({
    color: farbe,
    display: 'inline-flex',
    alignItems: 'center',
    gap: token.marginXXS,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  });
  const gruende = (
    <>
      {pflichtSichtbar.map((seite) => (
        <span
          key={seite}
          id={`${pflichtGrundId}-${seite}`}
          role="alert"
          data-lfh="etb-pflicht-hinweis"
          style={grundStil(rollen.alarmText)}
        >
          <IconWarndreieck />
          <span>{FEHLT[seite]}</span>
        </span>
      ))}
      {zukunftJetzt && (
        <span
          id={zeitGrundId}
          role="alert"
          data-lfh="etb-zeit-grund"
          style={grundStil(rollen.alarmText)}
        >
          <IconWarndreieck />
          <span>Zeit {zukunftJetzt}</span>
        </span>
      )}
      {zeitBefehlGrund && !zukunftJetzt && (
        // Höflich, nicht `alert`: der Grund erscheint beim Tippen, nicht beim Absenden, und
        // unterbräche sonst die Eingabe am Vorleser.
        <span
          id={zeitGrundId}
          role="status"
          data-lfh="etb-zeit-hinweis"
          style={grundStil(rollen.alarmText)}
        >
          <IconWarndreieck />
          <span>/zeit: {zeitBefehlGrund}</span>
        </span>
      )}
      {nachtragMin != null && (
        <span data-lfh="etb-nachtrag-hinweis" style={grundStil(rollen.achtungText)}>
          {nachtragHinweis(nachtragMin)}
        </span>
      )}
      {laengenHinweis && (
        <span role="alert" data-lfh="etb-laengen-hinweis" style={grundStil(rollen.alarmText)}>
          <IconWarndreieck />
          <span>{laengenHinweis}</span>
        </span>
      )}
      <Zeichenzaehler wert={inhalt} max={ETB_INHALT_MAX} />
    </>
  );

  const einheitenTreffer =
    menuModus === 'at' ? filterAtEintraege(menuFilter, funkrufnamen, typ) : null;

  // „+ Anhang“: ein antd-Knopf plus unsichtbare Dateieingabe statt antds `Upload` — der wickelte
  // den Knopf in ein zweites `role="button"` mit eigenem Tabstopp.
  const anGrenze = dateien.length >= ETB_ANHAENGE_MAX;
  // Zweiter Kanal neben dem Grau (WCAG 1.4.1), in wenigen Wörtern statt eines Satzes (LFH-1078):
  // ohne Netz „offline“, sonst der Zähler „3/10“, sobald Dateien gewählt sind — an der Grenze ist
  // er der Grund der Sperre.
  const anhangGrund = !online
    ? 'offline'
    : dateien.length > 0
      ? `${dateien.length}/${ETB_ANHAENGE_MAX}`
      : null;
  const textKnopf = (props: React.ComponentProps<typeof Button>) => (
    <Button type="link" {...props} style={{ paddingInline: 0, flexShrink: 0, ...props.style }} />
  );
  // Am Spiegel gehen keine Anhänge (LLH-1492, design.md D9: der Server lehnt sie mit 400 ab).
  const anhangTeil = istSpiegel(einsatz) ? null : (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS, flexShrink: 0 }}
    >
      {textKnopf({
        disabled: !online || sendet || anGrenze,
        'aria-describedby': anhangGrund != null ? anhangGrundId : undefined,
        icon: (
          <span aria-hidden="true" style={{ display: 'inline-flex' }}>
            <IconBueroklammer />
          </span>
        ),
        onClick: () => dateiEingabe.current?.click(),
        children: 'Anhang',
      })}
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
      {/* In `text2`, nicht `Typography` „secondary": der hält am Tag den 7 : 1-Boden auf dem Grund
         der Erfassung nicht (e2e `etb-anhang-pruefliste`). */}
      {anhangGrund != null && (
        <span
          id={anhangGrundId}
          data-lfh="etb-anhang-grund"
          style={{ ...(online ? monoStil(12) : {}), color: rollen.text2, whiteSpace: 'nowrap' }}
        >
          {anhangGrund}
        </span>
      )}
    </span>
  );

  const erfassenKnopf = (
    // Die Sendetaste als Kappe statt als Satz (LFH-1078), nur mit feinem Zeiger: mit grobem sendet
    // Return nicht (LFH-955, D1). Erst ab `lg`: darunter kostete die Kappe dem Textfeld seinen
    // Anteil an der Zeile. Die Kappe ist `aria-hidden`; die Zeit eines Nachtrags steht im Wort und
    // damit im zugänglichen Namen. Die Kürzel nennt `aria-keyshortcuts` auf jeder Breite.
    <Button
      type="primary"
      loading={sendet}
      aria-keyshortcuts={istBeruehrung ? KUERZEL_GROB : KUERZEL_FEIN}
      onClick={() => void absenden()}
      style={{ flexShrink: 0 }}
    >
      {fortschritt ? `Lädt hoch (${fortschritt.n}/${fortschritt.von}) …` : knopfText}
      {!istBeruehrung && !fortschritt && abBreite('lg') && (
        <Tastenkuerzel aria-hidden style={{ marginInlineStart: token.marginXS }}>
          ↵
        </Tastenkuerzel>
      )}
    </Button>
  );

  const vorschauKnopf = formatiert ? (
    <Button
      type="text"
      icon={
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          <IconAuge />
        </span>
      }
      aria-pressed={vorschauOffen}
      onClick={() => setVorschauGewaehlt((v) => !v)}
    >
      Vorschau
    </Button>
  ) : null;

  const rechts = (
    <span
      style={{
        marginInlineStart: istSchmal ? undefined : 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        gap: token.marginSM,
        flexShrink: 0,
      }}
    >
      {!veranlassungOffen &&
        !metadaten.veranlassung &&
        textKnopf({
          disabled: sendet,
          onClick: () => fokusFeld('veranlassung'),
          children: '+ Veranlassung',
        })}
      {anhangTeil}
      {/* Nicht gesperrt beim Senden: ein langer Upload hält keinen weiteren Entwurf auf (LFH-117). */}
      {onWeitererEntwurf &&
        textKnopf({ onClick: onWeitererEntwurf, children: '+ weiterer Entwurf' })}
      {!berichtigungZu &&
        rufname.standard != null &&
        textKnopf({
          disabled: sendet,
          title: `Eigene Stelle: ${rufname.standard.von}`,
          onClick: () => setRufnameAendern(true),
          children: 'Eigene Stelle ändern',
        })}
      {!berichtigungZu &&
        typ === 'lage' &&
        !lageberichteGesperrt &&
        // Gesperrt beim Senden: der Sprung hängte die Erfassung ab, der Versand liefe unsichtbar
        // weiter und ein Upload-Fehler stünde nirgends.
        textKnopf({
          disabled: sendet,
          onClick: () => navigate(lageberichtePfad(einsatz.id)),
          children: 'Als strukturierten Lagebericht erfassen →',
        })}
    </span>
  );

  return (
    // `etb-erfassung-card` trägt keine CSS-Regel, bleibt aber: `e2e/seitenrinne.spec.ts` misst an
    // ihr, dass der Inhalt der Leiste auf der Seitenrinne steht.
    <div
      className="etb-erfassung-card"
      data-lfh="etb-erfassung"
      // Das erste leere Pflichtfeld, für Fokuswege von außen (`EtbPage`, `?neu=1`).
      data-startfeld={(berichtigungZu ? undefined : fehlendeSeiten(wirksam)[0]) ?? undefined}
    >
      {berichtigungZu && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title={berichtigungTitel(berichtigungZu, berichtigungGrundNr)}
          action={
            // Gesperrt, solange sie gesendet wird: der Versand liefe sonst trotzdem durch.
            <Button disabled={sendet} onClick={onBerichtigungAbbrechen}>
              Abbrechen
            </Button>
          }
        />
      )}

      {rufnameAbfrageOffen && !eingeklappt && (
        <RufnameAbfrage
          // Neu montiert beim Wechsel zwischen erster Abfrage und Ändern: die Felder starten
          // dann mit dem jeweils richtigen Wert.
          key={rufname.standard ? 'aendern' : 'erste'}
          quellen={vonAnQuellen}
          standard={rufname.standard}
          vorschlag={anVorbelegung(einsatz)}
          onUebernehmen={async (wert) => {
            await rufname.setze(wert);
            setRufnameAendern(false);
            setPflicht([]);
            fokusInsFeld();
          }}
          onAbbrechen={rufname.standard ? () => setRufnameAendern(false) : undefined}
        />
      )}

      {!eingeklappt && (
        <div style={{ marginBottom: token.marginXS }}>
          <EtbFeldzeile
            typ={berichtigungZu ? null : typ}
            onTyp={typWaehlen}
            metadaten={metadaten}
            wirksam={wirksam}
            ausVorgabe={(seite) => ausStandard(seite, metadaten, rufname.standard, vorgabeTyp)}
            quellen={vonAnQuellen}
            onFeld={setzeFeld}
            onFertig={fokusInsFeld}
            pflicht={pflichtSichtbar}
            pflichtId={(seite) => `${pflichtGrundId}-${seite}`}
            zeitGrund={zukunftJetzt ?? zeitBefehlGrund}
            zeitGrundId={zeitGrundId}
            nachtrag={nachtragMin != null}
            veranlassungOffen={veranlassungOffen}
            onVeranlassungSchliessen={() => setVeranlassungOffen(false)}
            gesperrt={sendet}
            schmal={istSchmal}
            einzeilig={einzeilig}
            anhang={
              einzeilig ? (
                <>
                  {gruende}
                  {protokollSchalter}
                  {schalter}
                  {rechts}
                </>
              ) : undefined
            }
            refs={{
              zeit: zeitRef,
              von: vonRef,
              an: anRef,
              meldeweg: meldewegRef,
              veranlassung: veranlassungRef,
            }}
          />
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <Schnellerfassungszeile
          // Ab `md` füllt das Textfeld die Zeile, damit ein Funkspruch am Stück gegenzulesen ist
          // (LFH-955, design.md D2). Unter `md` steht der Typ-Knopf davor, auch eingeklappt; das
          // Feld behält so beim Aufklappen seinen Platz im Baum.
          feldFuellt
          praefix={praefix}
          rahmenFarbe={typFarbe.kante}
          hinweis={
            istSchmal ? undefined : (
              <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
                {vorschauKnopf}
                {erfassenKnopf}
              </div>
            )
          }
        >
          {/* Die Schnellerfassung steht ohne eigene Überschrift unter dem Seitentitel (h1). */}
          <MarkdownEditor
            ref={textRef}
            unterEbene={1}
            variante="kompakt"
            placeholder={PLATZHALTER}
            autoSize={{ minRows: 1, maxRows: 4 }}
            umschalterAussen
            vorschauOffen={vorschauOffen}
            value={inhalt}
            onChange={onInhaltChange}
            onKeyDown={onKeyDown}
            // Die Bildschirmtastatur zeigt „Return“, nicht „Senden“: Return bricht dort um (D1).
            enterKeyHint="enter"
            readOnly={sendet}
            maxLength={ETB_INHALT_MAX}
            zaehlerAussen
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

      {/* Fußzeile (Spec „Einstellungen in der Fußzeile der Erfassung“): links Gründe und die
         beiden Schalter, rechts die Textknöpfe; unter `md` rollt sie waagerecht, nur „Erfassen“
         steht fest am Ende. */}
      {!eingeklappt && !einzeilig && (
        <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM }}>
          <div
            data-lfh="etb-fusszeile"
            // Im Handschuh-Betrieb rollt sie auch ab `md` statt umzubrechen: eine zweite Reihe
            // kostete 72 px, und die Leiste risse am Fükw die halbe Fensterhöhe (Spec „Einstellungen
            // in der Fußzeile der Erfassung“, Szenario „Fükw im Handschuh-Betrieb“).
            style={{
              ...fusszeileStil(istSchmal || token.controlHeight >= 72, token),
              flex: '1 1 auto',
            }}
          >
            {gruende}
            {protokollSchalter}
            {schalter}
            {rechts}
          </div>
          {istSchmal && erfassenKnopf}
        </div>
      )}

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
        <Alert
          type="error"
          showIcon
          style={{ marginTop: token.marginXS }}
          title={anhangHinweis}
          action={
            anhangHinweis === ANHANG_OFFLINE_SENDEN && dateien.length > 0 ? (
              <Button
                disabled={sendet}
                onClick={() => {
                  setzeDateien([]);
                  setAnhangHinweis(null);
                  fokusInsFeld();
                }}
              >
                Anhänge entfernen
              </Button>
            ) : undefined
          }
        />
      )}
      {ablehnung && (
        // Eine Zeile wie der Dateihinweis: die angepinnte Leiste hat ein Höhenbudget (≤ 50 %).
        <Alert
          type="error"
          showIcon
          data-lfh="etb-ablehnung"
          style={{ marginTop: token.marginXS }}
          title={ablehnung}
        />
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
