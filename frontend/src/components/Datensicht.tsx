import { IkoneChevronRechts, IkoneChevronRunter } from '../ikonen';
import { Button, Popconfirm, Space, Typography, theme } from 'antd';
import type { Key, ReactNode } from 'react';
import type { TableColumnType } from 'antd';
import {
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import KatalogTabelle, { type KatalogSpalte } from './KatalogTabelle';
import { Liste, ListenEintrag, type ListenKopf } from './Liste';
import type { UnterEbene } from './Markdown';
import { Select } from './Select';
import StatusTag from './StatusTag';
import StatusWahl, { type StatusBedienung } from './StatusWahl';
import Augenbraue from './instrument/Augenbraue';
import { monoStil, rollenwerte } from './instrument/rollenwerte';
import { useViewport, type AbBreitePunkt } from './useViewport';
import { MenueAusloeser, type MenueEintrag } from './MenueAusloeser';
import {
  etikettVon,
  hatWaehlbareSpalten,
  sichtbareSpalten,
  SpaltenSchalter,
} from './SpaltenSchalter';

// Zählung und Schalter wohnen in `SpaltenSchalter.tsx` (zweiter Träger: `KatalogTabelle`). Der
// Weiterexport hält Bestandsimporte stabil; neue Aufrufer importieren direkt von dort.
export { etikettVon, hatWaehlbareSpalten, sichtbareSpalten };
import type { StatusDarstellung } from '../theme/statusFarben';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';

/**
 * Datensicht-Primitiv der Einsatzmodule (LFH-330 · B2): EINE Spaltendefinition je Modul, zwei
 * Darstellungsformen. `form`: `'tabelle'` immer Tabelle, `'karte'` immer Karte, `'auto'` Tabelle ab
 * `md` und Karte darunter. Der Tabellenzweig rendert durch `KatalogTabelle` (EINE
 * Scroll-/Sticky-/Fixier-Wahrheit); diese Datei setzt kein Bildlauf-Prop.
 *
 * ── DIE KARTEN-AUSNAHME (begründungspflichtig) ──
 *
 * `form: 'auto'` löst unter `md` eine Tabelle in Karten auf, entgegen der Regel „auf schmalem
 * Schirm wird eine Tabelle angepasst, nicht in Karten aufgelöst“. Träger der Ausnahme ist der
 * Kontext **mobil** (~390 px, einhändig, keine Vergleichsansichten): ein Datensatz, der als
 * EINHEIT gelesen wird (Fahrzeug, Person, Bewegung), ist keine Vergleichsaufgabe.
 *
 * DIE TRENNLINIE, damit die Ausnahme nicht wandert:
 *   · `KatalogTabelle` + Bildlauf bleibt für die Stammdaten-VERGLEICHSTABELLEN; keine wird Karte.
 *   · `form: 'tabelle'` für Vergleichsflächen, die auch schmal verglichen werden (Meldebild;
 *     Prüflisten-Kriterium 14 verbietet dort Karten).
 *   · `form: 'auto'` für Einsatzmodule, in denen ein Datensatz eine Einheit ist.
 *   · `form: 'karte'` für Module, die kartenbasiert gelesen werden (Befehle, Lageberichte).
 *
 * Was die Karte NICHT kann, ist an der Aufrufstelle sichtbar: eine Spalte ohne Platz im
 * Kartenplan erscheint dort nicht. Aufgeklappt wird nur über `aufklappen`, in BEIDEN Zweigen mit
 * einem Zustand (LFH-697).
 *
 * ── FÜNF ZUSICHERUNGEN ──
 *
 * 1. **Genau EIN Zweig im Baum**, kein Umschalten per verborgener Fläche: ein verborgener Zweig
 *    machte jedes „unter md keine Tabelle“-Gate bedeutungslos und montierte Steuerelemente
 *    doppelt.
 * 2. **EINE Reihenfolge, EINE Menge für beide Zweige.** antds Sortier- und Filterhaken sind am
 *    Spaltentyp abgeschnitten, weil `Table` deren Zustand intern hält; sortiert und gefiltert
 *    wird hier, die Tabelle bekommt nur den Pfeil.
 * 3. **EINE Sichtbarkeitswahrheit.** `abBreite` ersetzt antds Breiten-Prop, das Verbergen-Flag
 *    ist gestrichen, beide Ausblendungsgründe fließen in DENSELBEN Zähler (Kriterium 14).
 * 4. **Das Tastaturziel der Zeile ist die Titelzelle.** Bei gesetztem `titel.ziel` rendert sie
 *    in BEIDEN Zweigen einen echten `<Link>` mit Höhe aus `controlHeight`; `ListenEintrag` legt
 *    `onClick` auf ein nacktes `<div>` ohne Rolle und Tastaturbedienung.
 * 5. **Zeilen springen nicht unter dem Cursor.** Solange der Fokus in der Sicht liegt, sind
 *    Zeilenmenge und -reihenfolge eingefroren, Zellinhalte laufen weiter; Zufluss erscheint als
 *    Banner (WCAG 3.2.5, CLS ≤ 0,1). Die Werkzeugzeile steht IMMER, auch leer.
 *
 * ── VIER FALLEN ──
 *
 * · Die Werkzeugzeile liegt AUSSERHALB des Tabellenrahmens: `katalogtabelle-schmal.spec.ts`
 *   misst die Bildlaufbreite am Tabellenwurzelknoten.
 * · `const K` ist verlierbar: eine ANNOTIERTE Spaltenliste (statt über `spaltenFuer<T>()`) weitet
 *   `K` auf `string`. Deshalb prüft {@link pruefeKartenplan} die Slot-Schlüssel im DEV-Effekt, und
 *   der Guard verlangt die Marke `spaltenFuer` je Konsumentendatei.
 * · Der Statusslot ist NICHT das `render` der Statusspalte (dort drückt ein Auswahlfeld mit fester
 *   Mindestbreite die 390-px-Karte breit); er nimmt eine `StatusDarstellung` mit Pflicht-`label`.
 * · Filter, Suche und Gruppen sind im Baummodus VERBOTEN: die Aggregate der Elternzeilen sind
 *   stromaufwärts über die Vollmenge kumuliert (`kraefte/kraeftebild.ts`) und lögen still, fiele
 *   hier eine Zeile weg. Vorgefiltert wird stromaufwärts (`filtereKraefte`).
 */

// ── Formachse ────────────────────────────────────────────────────────────────────────
/**
 * `'auto'` Tabelle ab `md`, Karte darunter (begründungspflichtig, fester Umbruchpunkt).
 * `'tabelle'` immer Tabelle, für Vergleichsflächen (Meldebild, Kriterium 14).
 * `'karte'` immer Karte, für Module, die kartenbasiert gelesen werden (Befehle, Lageberichte).
 */
type Darstellungsform = 'auto' | 'tabelle' | 'karte';

// ── Spaltenregister ──────────────────────────────────────────────────────────────────
/**
 * Was dem Primitiv gehört und der Aufrufer nicht setzen darf. Sortier- und Filterhaken gehören
 * `Datensicht` (antd hält sie intern, der Kartenzweig sähe sie nicht), `fixed` gehört
 * `KatalogTabelle`. antds Breiten-Prop und Verbergen-Flag sind durch
 * {@link DatensichtSpalte.abBreite} bzw. den Spaltenschalter ersetzt, sonst verbärgen sie Spalten,
 * die der Zähler nicht kennt.
 */
type AntdErbe<T> = Omit<
  TableColumnType<T>,
  | 'key'
  | 'sorter'
  | 'sortOrder'
  | 'defaultSortOrder'
  | 'sortDirections'
  | 'filters'
  | 'filteredValue'
  | 'defaultFilteredValue'
  | 'onFilter'
  | 'filterDropdown'
  | 'filterIcon'
  | 'filterMultiple'
  | 'filterSearch'
  | 'fixed'
  | 'responsive'
  | 'hidden'
>;

/** EINE Spaltendefinition je Modul. Beide Zweige schöpfen ausschließlich hieraus. */
export type DatensichtSpalte<T, K extends string = string> = AntdErbe<T> & {
  /** Pflicht (antd hat sie optional): der Kartenplan referenziert genau diesen Schlüssel. */
  key: K;
  /** Klartext für Karte, Spaltenschalter und Sortierauswahl. Pflicht, sobald `title` kein String ist. */
  etikett?: string;
  /** Macht die Spalte sortierbar — EINE Vergleichsgrundlage für BEIDE Zweige. Leerwerte ans Ende. */
  sortWert?: (zeile: T) => string | number | null | undefined;
  /** Beitrag zur Freitextsuche. Fehlt er, trägt die Spalte nicht zur Suche bei. */
  suchText?: (zeile: T) => string | null | undefined;
  /** Spaltenfilter: Werteliste UND Prädikat, nie nur eins davon. */
  filter?: {
    werte: readonly { readonly text: string; readonly value: string }[];
    trifft: (zeile: T, wert: string) => boolean;
  };
  /** Erst ab dieser Breite in der TABELLE sichtbar (Ersatz für antds Breiten-Prop). */
  abBreite?: AbBreitePunkt;
  /**
   * Diese Spalte FLIESST im Tabellenzweig: sie nimmt den Rest der Breite und bricht um, statt die
   * Tabelle zu verbreitern (LFH-523). Wert ist ihr Mindestmaß in px, durchgereicht an
   * {@link KatalogSpalte.mindestBreite}. Im Kartenzweig wirkungslos, eine Karte bricht ohnehin um.
   */
  mindestBreite?: number;
  /** Nicht abwählbar (Aktionsspalte). Spalte 0 ist es immer, unabhängig vom Flag. */
  immerSichtbar?: boolean;
  /**
   * Zahl, Zeit, Kennung (Funkrufname, Nr., Koordinate): Mono mit `tabular-nums` in BEIDEN Zweigen.
   * Durchgereicht an {@link KatalogSpalte.zahl}.
   */
  zahl?: boolean;
};

/**
 * Bewahrt die Schlüssel-Literale, ohne die T-Angabe zu verlieren; curried, weil TypeScript keine
 * teilweise Typargument-Inferenz kennt. Eine als `readonly DatensichtSpalte<Person>[]` ANNOTIERTE
 * Liste weitet `K` auf `string`; dagegen helfen {@link pruefeKartenplan} und die Guard-Marke
 * `spaltenFuer`.
 */
export function spaltenFuer<T extends object>(): <const K extends string>(
  spalten: readonly DatensichtSpalte<T, K>[],
) => readonly DatensichtSpalte<T, K>[] {
  return (spalten) => spalten;
}

// ── Kartenplan ───────────────────────────────────────────────────────────────────────
/**
 * GENAU EINE Primäraktion, als Deskriptor statt `ReactNode`-Slot: Form, Höhe und Trefffläche
 * gehören dem Primitiv, eine Klein-Variante oder ein Gefahren-Anstrich sind nicht einschmuggelbar.
 *
 * `bestaetigung` hält die Rückfrage vor „Entfernen“ auch im Kartenzweig (Kriterium 4). Der
 * AUSLÖSER bleibt immer neutral (Rot bedient nichts); nur der OK-Knopf der Rückfrage wird für
 * unumkehrbare Aktionen rot ({@link bestaetigungGefahr}).
 */
export interface PrimaerAktion<T> {
  etikett: string;
  onKlick: (zeile: T) => void;
  /** Rückfragetitel. Gesetzt ⇒ Rückfrage vor dem Auslösen; der Auslöser bleibt neutral. */
  bestaetigung?: string;
  /**
   * Nur mit `bestaetigung`: färbt den OK-Knopf der Rückfrage rot — für unumkehrbare
   * Aktionen. Der Auslöser bleibt davon unberührt.
   */
  bestaetigungGefahr?: true;
  /**
   * Zugänglicher Name des Auslösers je Zeile (`aria-label`), z. B. „Dokument X entfernen".
   * Ohne ihn liefern n Karten n gleichnamige Knöpfe; das sichtbare `etikett` bleibt kurz.
   */
  zugaenglicherName?: (zeile: T) => string;
  /** Zeilenweise Ausblendung (Schreibrecht, Zustand). Fehlt = immer sichtbar. */
  sichtbar?: (zeile: T) => boolean;
}

/**
 * Weitere Zeilenaktionen, GEBÜNDELT (LFH-365): die EINE Primäraktion bleibt sichtbar, alles
 * Weitere steht in einem Menü hinter dem Baustein {@link MenueAusloeser} (LFH-683).
 *
 * `eintraege` wird NACH der Rechte- und Zustandsprüfung ausgewertet: liefert es nichts, gibt es
 * keinen Auslöser, auch keinen deaktivierten.
 */
export interface WeitereAktionen<T> {
  eintraege: (zeile: T) => readonly MenueEintrag[];
  /** Zugänglicher Name des Auslösers MIT Zeilenkennung („Aktionen zu Bezirk X"). */
  zugaenglicherName: (zeile: T) => string;
  onWahl: (key: string, zeile: T) => void;
  /**
   * Läuft eine Aktion aus dem Menü für diese Zeile gerade (z. B. Entfernen bis zur Serverantwort,
   * LFH-654)? Dann trägt der Auslöser den Ladezustand und öffnet das Menü nicht — keine zweite
   * Löschung. Die Kennzeichnung der Zeile als Text bleibt Sache des Spalten-`render` (Kriterium 6).
   */
  laeuft?: (zeile: T) => boolean;
}

/**
 * Titelzeile der Karte UND erste Spalte der Tabelle. `ziel` macht die Titelzelle in BEIDEN
 * Zweigen zu einem echten `<Link>`, dem Tastaturziel der Zeile. REGEL: trägt `ziel` einen Wert,
 * darf das `render` der Titelspalte KEINEN Anker erzeugen (verschachtelte Links).
 */
export interface TitelBezug<T, K extends string> {
  spalte: K;
  /** `null`: diese Zeile hat kein Ziel (etwa ein Sammelknoten im Baum), der Titel bleibt Text. */
  ziel?: (zeile: T) => string | null;
}

/** Kontext, den der Kartenzweig jedem Eintrag mitgibt (nur `art: 'eigen'`). */
export interface KartenKontext<T> {
  zeile: T;
  index: number;
  /** 0 = Wurzel. Einrückung wächst bis {@link TIEFE_DECKEL} und dann nicht weiter. */
  tiefe: number;
  aufklappen?: { offen: boolean; umschalten: () => void; anzahlKinder: number };
}

export type Kartenplan<T, K extends string> =
  | {
      art: 'plan';
      titel: TitelBezug<T, K>;
      /**
       * Statusetikett als Vertragstyp, KEIN Farbstring: `label` ist der erzwungene zweite Kanal.
       * `null` = kein Etikett. NICHT das `render` der Statusspalte (dessen Auswahlfeld drückt die
       * 390-px-Karte breit).
       */
      status?: (zeile: T) => StatusDarstellung | null;
      /**
       * Macht das Statusetikett BEDIENBAR (LFH-339), als Deskriptor, damit Form, Höhe und Trefffläche
       * beim Primitiv bleiben. Bedient wird, wo der Status steht, nicht am {@link PrimaerAktion}-Slot
       * (der ist mit „Entfernen“ belegt). Fehlt das Feld oder liefert es `null`, bleibt das Etikett
       * Anzeige.
       */
      statusBedienung?: (zeile: T) => StatusBedienung | null;
      /** HÖCHSTENS DREI Sekundärfelder — der Tupeltyp erzwingt die Obergrenze. */
      sekundaer?: readonly [K?, K?, K?];
      aktion?: PrimaerAktion<T>;
      /** Gebündelte weitere Aktionen neben der Primäraktion — siehe {@link WeitereAktionen}. */
      weitere?: WeitereAktionen<T>;
    }
  | {
      art: 'eigen';
      /** Nur mit Eintrag in `datensicht.guard.test.ts` (`KARTEN_EIGENBAU`). */
      render: (ktx: KartenKontext<T>) => ReactNode;
    };

// ── Sortierung, Gruppierung, Baum, Zufluss ───────────────────────────────────────────
/** `null` = Reihenfolge wie geliefert (Serverordnung unangetastet). */
type Sortierung<K extends string> = { spalte: K; richtung: 'auf' | 'ab' } | null;

/**
 * Gruppenachse; beide Zweige nutzen dieselben Schlüssel und Zähler, nicht dieselbe Form:
 *  · Kartenzweig: echte Gruppenköpfe („verfügbar · 7“) über verschachtelten Listen.
 *  · Tabellenzweig: die Gruppenachse wird FÜHRENDE Sortierachse, Zähler als Streifen in der
 *    Werkzeugzeile. Keine synthetischen Gruppenzeilen: Spaltenfixierung × Zellverbünde sind
 *    ungeprüft, und `KatalogTabelle` fixiert Spalte 0 immer.
 */
interface Gruppierung<T> {
  schluessel: (zeile: T) => string;
  etikett: (wert: string) => string;
  /** Feste Gruppenfolge; unbekannte Werte hängen in Antreffreihenfolge hinten an. */
  reihenfolge?: readonly string[];
}

/**
 * Was die Sicht über die Achse hinaus braucht: die Gruppenköpfe des Kartenzweigs sind
 * Überschriften (LFH-470), deren Ebene nur der Einbauort kennt — Ebene der nächsten Überschrift
 * über der Sicht (Seitentitel = 1, Paneel = 2, …). Getrennt von {@link Gruppierung}, weil
 * `effektiveDaten` nur die Achse liest.
 */
type SichtGruppierung<T> = Gruppierung<T> & { unterEbene: UnterEbene };

/**
 * Feldname, unter dem `T` Kinder DESSELBEN Typs trägt — sonst `never`. `-?` allein genügt
 * nicht: `T[K]` trägt bei optionalen Feldern weiter `| undefined`, deshalb `NonNullable`.
 */
type KinderFeld<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends readonly T[] ? K & string : never;
}[keyof T];

/**
 * Beschrifteter Aufklappbereich je Zeile, in BEIDEN Zweigen gleich (LFH-676).
 *
 * Der Auslöser ist ein antd-`Button` mit sichtbarem `etikett`, `aria-expanded` und der
 * Zeilenkennung im zugänglichen Namen, nicht antds 16-px-Symbol (Name aus der Locale, zu kleine
 * Trefffläche). Aufklappen ist LESEN und zählt nicht gegen „eine Primäraktion + `weitere`“.
 *
 * `inhalt` wird erst beim Aufklappen gerendert. Der Zustand gehört der Sicht und überlebt den
 * Wechsel zwischen Karte und Tabelle.
 */
interface Aufklappbereich<T> {
  /** Sichtbares Etikett des Auslösers („Verlauf“). */
  etikett: string;
  /** Zugänglicher Name MIT Zeilenkennung („Verlauf zu Bezirk Uferstraße“). */
  zugaenglicherName: (zeile: T) => string;
  inhalt: (zeile: T) => ReactNode;
}

/** Rekursive Sicht. EIN Prop, damit Feldname und Aufklappzustand nicht getrennt setzbar sind. */
interface BaumSicht<T> {
  kinder: KinderFeld<T>;
  /** KONTROLLIERT — der Druckpfad der Kräfteübersicht setzt hier alle Schlüssel. */
  aufgeklappt: readonly Key[];
  onAufgeklappt: (schluessel: Key[]) => void;
}

/**
 * Verhalten bei nachfließenden Daten (Kriterium 12, WCAG 3.2.5, CLS ≤ 0,1).
 *
 * `'sammelbanner'` (Default): solange der Fokus INNERHALB der Sicht liegt, bleiben Zeilenmenge und
 *   -reihenfolge eingefroren; Zellinhalte aktualisieren weiter. Neue Zeilen erscheinen als Banner
 *   („7 neue Einträge — anzeigen“).
 * `'sofort'`: kein Einfrieren, nur für Flächen ohne fokussierbare Zeileninhalte.
 */
type Zufluss = 'sammelbanner' | 'sofort';

// ── Props ────────────────────────────────────────────────────────────────────────────
interface DatensichtProps<T extends object, K extends string> {
  /**
   * Zugängliche Bezeichnung: `aria-label` an einem `<section>` (ein nacktes `div` hat keine Rolle),
   * Präfix der DEV-Diagnosen und Beschriftung des Spaltenschalters.
   */
  bezeichnung: string;
  /**
   * DIE Inferenzquelle für `K`. Alle anderen K-Positionen sind per `NoInfer` ausgenommen, sonst
   * weitete ein Tippfehler im Kartenplan `K` um sein eigenes Literal.
   */
  spalten: readonly DatensichtSpalte<T, K>[];
  daten: readonly T[];
  zeilenSchluessel: (keyof T & string) | ((zeile: T) => Key);
  karte: Kartenplan<T, NoInfer<K>>;
  /** Default `'auto'`. */
  form?: Darstellungsform;
  ladend?: boolean;
  /** Tabelle: `locale.emptyText`; Karte: `Liste emptyText`. KEIN neuer Leerzustands-Knoten. */
  leerText?: ReactNode;

  // Zustand — Voreinstellung ODER kontrolliert, nie beides
  standardSortierung?: Sortierung<NoInfer<K>>;
  sortierung?: Sortierung<NoInfer<K>>;
  onSortierung?: (s: Sortierung<NoInfer<K>>) => void;
  /** Freitextsuche über alle Spalten mit `suchText`. Im Baummodus verboten. */
  suche?: { platzhalter: string };
  gruppen?: SichtGruppierung<T>;
  /** Baumsicht. Schließt `suche`, Spaltenfilter, `gruppen` und `aufklappen` aus. */
  baum?: BaumSicht<T>;
  /** Default `'sammelbanner'`. */
  zufluss?: Zufluss;

  // Spaltensichtbarkeit — Voreinstellung ODER kontrolliert
  spaltenAusVoreinstellung?: readonly NoInfer<K>[];
  spaltenAus?: readonly NoInfer<K>[];
  onSpaltenAus?: (schluessel: NoInfer<K>[]) => void;

  /** EINE Klasse für BEIDE Zweige: `rowClassName` bzw. `ListenEintrag className`. */
  zeilenKlasse?: (zeile: T) => string | undefined;
  /**
   * Zeilenklick als KOMFORT, nur im Tabellenzweig (`onRow`). Tastatur- und Berührungsziel ist in
   * beiden Zweigen `karte.titel.ziel`.
   */
  onZeileKlick?: (zeile: T) => void;
  /** Zusatzknöpfe links in der Werkzeugzeile (z. B. „Drucken"). */
  werkzeuge?: ReactNode;
  /** Einziger Aufklappweg, beschriftet, in beiden Zweigen (LFH-697); schließt `baum` aus. */
  aufklappen?: Aufklappbereich<T>;
}

// ── Konstanten ───────────────────────────────────────────────────────────────────────
/** Höchstzahl der Sekundärfelder. Am Tupeltyp erzwungen, hier nur benannt. */
export const MAX_SEKUNDAER = 3;
/** Ab dieser Tiefe wächst die Karteneinrückung nicht weiter (390 px). */
export const TIEFE_DECKEL = 3;

// ── Reine Funktionen: hier wohnt die Drift, deshalb exportiert ────────────────────────

/** Zeilenschlüssel als ID-Baustein: ohne Leerraum, damit eine IDREF-Liste nicht zerfällt. */
function idTeil(k: Key): string {
  return encodeURIComponent(String(k));
}

/** Läuft den vollen `dataIndex`-Pfad; `undefined` ohne auflösbaren Bezug. */
function pfadWert<T>(spalte: DatensichtSpalte<T>, zeile: T): unknown {
  const bezug = spalte.dataIndex;
  if (bezug == null) return undefined;
  const pfad = Array.isArray(bezug) ? bezug : [bezug];
  let wert: unknown = zeile;
  for (const glied of pfad) {
    if (wert == null || typeof wert !== 'object') return undefined;
    wert = (wert as Record<string, unknown>)[String(glied)];
  }
  return wert;
}

/**
 * Der Zellinhalt, den BEIDE Zweige benutzen. antds `render` darf eine Zellbeschreibung
 * `{ props?, children? }` liefern; React-Elemente tragen ebenfalls `props`, deshalb ZUERST
 * `isValidElement` prüfen. Zellverbund-Angaben sind in der Karte bedeutungslos.
 */
export function zelle<T>(spalte: DatensichtSpalte<T>, zeile: T, index: number): ReactNode {
  const wert = pfadWert(spalte, zeile);
  if (!spalte.render) return wert as ReactNode;
  const ergebnis = spalte.render(wert, zeile, index);
  if (isValidElement(ergebnis)) return ergebnis;
  if (ergebnis != null && typeof ergebnis === 'object' && 'children' in ergebnis) {
    return (ergebnis as { children?: ReactNode }).children;
  }
  return ergebnis as ReactNode;
}

/**
 * Sortiert Text so, wie eine Einsatzkraft ihn liest: „Florian 2“ vor „Florian 10“ (`numeric`).
 * Die Sprache steht fest auf `de`, sonst hinge die Reihenfolge an der Umgebung.
 */
const KOLLATOR = new Intl.Collator('de', { numeric: true });

/** Vergleicht zwei Sortierwerte; Leerwerte landen IMMER hinten, in beiden Richtungen. */
function vergleiche(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  richtung: 'auf' | 'ab',
): number {
  const aLeer = a == null;
  const bLeer = b == null;
  // Vor dem Richtungsfaktor entschieden — sonst wanderten Leerwerte beim Umschalten nach vorn.
  if (aLeer || bLeer) return aLeer && bLeer ? 0 : aLeer ? 1 : -1;
  const faktor = richtung === 'auf' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * faktor;
  return KOLLATOR.compare(String(a), String(b)) * faktor;
}

/**
 * Die EINE Quelle der gerenderten Zeilen. Flach: filtern, suchen, gruppen-sortieren, sortieren.
 * Baum: `daten` unverändert.
 */
export function effektiveDaten<T extends object, K extends string>(args: {
  daten: readonly T[];
  spalten: readonly DatensichtSpalte<T, K>[];
  sortierung: Sortierung<K>;
  suchbegriff: string;
  filterWerte: Readonly<Record<string, readonly string[]>>;
  gruppen?: Gruppierung<T>;
  baum: boolean;
}): readonly T[] {
  const { daten, spalten, sortierung, suchbegriff, filterWerte, gruppen, baum } = args;
  // REFERENZGLEICH zurück: die Aggregate der Elternzeilen sind stromaufwärts über die
  // Vollmenge kumuliert und lögen still, wenn hier eine Zeile wegfiele.
  if (baum) return daten;

  let zeilen = daten;

  for (const spalte of spalten) {
    const gewaehlt = filterWerte[spalte.key];
    if (!spalte.filter || !gewaehlt || gewaehlt.length === 0) continue;
    const trifft = spalte.filter.trifft;
    zeilen = zeilen.filter((zeile) => gewaehlt.some((wert) => trifft(zeile, wert)));
  }

  const begriff = suchbegriff.trim().toLowerCase();
  if (begriff !== '') {
    const suchbar = spalten.filter((s) => s.suchText != null);
    zeilen = zeilen.filter((zeile) =>
      suchbar.some((s) => (s.suchText!(zeile) ?? '').toLowerCase().includes(begriff)),
    );
  }

  const sortSpalte = sortierung ? spalten.find((s) => s.key === sortierung.spalte) : undefined;
  const sortWert = sortSpalte?.sortWert;
  if (!gruppen && !sortWert) return zeilen;

  // Die Gruppenachse ist die FÜHRENDE Achse, damit die Gruppen zusammenhängend liegen, auch im
  // Tabellenzweig ohne Gruppenzeilen.
  const rang = gruppen ? gruppenRang(zeilen, gruppen) : undefined;
  return [...zeilen].sort((a, b) => {
    if (rang) {
      const abstand = rang.get(gruppen!.schluessel(a))! - rang.get(gruppen!.schluessel(b))!;
      if (abstand !== 0) return abstand;
    }
    if (!sortWert || !sortierung) return 0;
    return vergleiche(sortWert(a), sortWert(b), sortierung.richtung);
  });
}

/** Reihenfolge-Rang je Gruppenwert: feste Folge zuerst, Unbekanntes in Antreffreihenfolge. */
function gruppenRang<T>(zeilen: readonly T[], gruppen: Gruppierung<T>): Map<string, number> {
  const rang = new Map<string, number>();
  for (const wert of gruppen.reihenfolge ?? []) rang.set(wert, rang.size);
  for (const zeile of zeilen) {
    const wert = gruppen.schluessel(zeile);
    if (!rang.has(wert)) rang.set(wert, rang.size);
  }
  return rang;
}

/** Gruppen in Reihenfolge, je mit Zähler. Speist Kartenköpfe UND Zählerstreifen. */
export function gruppiere<T>(
  daten: readonly T[],
  gruppen: Gruppierung<T>,
): readonly { wert: string; etikett: string; zeilen: readonly T[] }[] {
  const eimer = new Map<string, T[]>();
  for (const zeile of daten) {
    const wert = gruppen.schluessel(zeile);
    const vorhanden = eimer.get(wert);
    if (vorhanden) vorhanden.push(zeile);
    else eimer.set(wert, [zeile]);
  }
  const rang = gruppenRang(daten, gruppen);
  // Nur BELEGTE Gruppen: ein leerer Kopf „· 0“ wäre Rauschen.
  return [...eimer.keys()]
    .sort((a, b) => rang.get(a)! - rang.get(b)!)
    .map((wert) => ({ wert, etikett: gruppen.etikett(wert), zeilen: eimer.get(wert)! }));
}

/** Klasse, die eine per Deeplink angesteuerte Zeile markiert (LFH-25). */
export const HERVORGEHOBEN = 'zeile-hervorgehoben';

/**
 * Scrollt die per Deeplink angesteuerte Zeile ins Bild, in BEIDEN Zweigen: `[data-row-key]` allein
 * trifft nur die Tabelle, unter `md` liefe der Sprung ins Leere. Deshalb hier und nicht in den
 * Seiten. `scrollIntoView` fehlt in jsdom; der optionale Aufruf hält das No-op fest.
 */
export function scrolleZurZeile(schluessel: Key): void {
  const ziel = document.querySelector(
    `[data-row-key="${schluessel}"], [data-lfh="datensicht-karte"].${HERVORGEHOBEN}`,
  );
  ziel?.scrollIntoView?.({ block: 'center' });
}

/**
 * Mängelliste des Kartenplans gegen das Spaltenregister; leeres Array = in Ordnung. `Datensicht`
 * gibt sie im DEV-Effekt an `console.warn` (Präfix `[Datensicht: <bezeichnung>]`), der Test ruft
 * sie direkt.
 */
export function pruefeKartenplan<T extends object, K extends string>(
  props: Pick<
    DatensichtProps<T, K>,
    'spalten' | 'karte' | 'suche' | 'baum' | 'gruppen' | 'aufklappen' | 'onZeileKlick'
  >,
  bezeichnung: string,
): string[] {
  const { spalten, karte, suche, baum, gruppen, aufklappen, onZeileKlick } = props;
  const befunde: string[] = [];
  const bekannt = new Map<string, DatensichtSpalte<T, K>>();
  for (const spalte of spalten) {
    if (bekannt.has(spalte.key)) {
      befunde.push(`Spaltenschlüssel "${spalte.key}" ist doppelt vergeben.`);
    }
    bekannt.set(spalte.key, spalte);
    if ('children' in spalte && spalte.sortWert != null) {
      befunde.push(
        `Spaltengruppe "${spalte.key}" trägt sortWert — eine Gruppe ist keine Blattspalte, ` +
          'die Sortierung bliebe wirkungslos.',
      );
    }
  }

  if (karte.art === 'plan') {
    if (!bekannt.has(karte.titel.spalte)) {
      befunde.push(
        `Kartentitel zeigt auf "${karte.titel.spalte}" — dazu gibt es keine Spalte ` +
          `in ${bezeichnung}.`,
      );
    }
    for (const slot of karte.sekundaer ?? []) {
      if (slot == null) continue;
      const spalte = bekannt.get(slot);
      if (!spalte) {
        befunde.push(`Sekundärfeld zeigt auf "${slot}" — dazu gibt es keine Spalte.`);
        continue;
      }
      if (etikettVon(spalte) == null) {
        befunde.push(
          `Sekundärfeld "${slot}" hat kein Etikett — das Kartenfeld stünde ohne Beschriftung.`,
        );
      }
    }
  }

  if (baum) {
    if (suche) befunde.push('suche ist im Baummodus verboten (Aggregate der Elternzeilen).');
    if (spalten.some((s) => s.filter != null)) {
      befunde.push('Spaltenfilter sind im Baummodus verboten (Aggregate der Elternzeilen).');
    }
    if (gruppen) befunde.push('gruppen und baum schließen sich aus.');
    if (aufklappen) befunde.push('aufklappen und baum schließen sich aus.');
    // Im Baummodus klappt die ganze Zeile auf; ein zusätzliches `onZeileKlick` wäre eine zweite
    // Wirkung auf demselben Klick.
    if (onZeileKlick) befunde.push('onZeileKlick und baum schließen sich aus.');
  }
  // Ein Eigenbau gibt `karte.render(...)` roh zurück: Auslöser und Bereich entstehen nur im
  // Plan-Modus. Ein Opt-in, das still nichts tut, wäre von einem kaputten nicht zu unterscheiden.
  if (aufklappen && karte.art === 'eigen') {
    befunde.push("aufklappen und karte.art 'eigen' schließen sich aus (Eigenbau rendert roh).");
  }
  return befunde;
}

// ── Zustand ──────────────────────────────────────────────────────────────────────────

/** Zeilenschlüssel einer Zeile, aus Feldname oder Funktion. */
function schluesselVon<T extends object>(
  zeilenSchluessel: (keyof T & string) | ((zeile: T) => Key),
  zeile: T,
): Key {
  return typeof zeilenSchluessel === 'function'
    ? zeilenSchluessel(zeile)
    : (zeile[zeilenSchluessel] as Key);
}

// ── Die Komponente ───────────────────────────────────────────────────────────────────

export default function Datensicht<T extends object, const K extends string>(
  props: DatensichtProps<T, K>,
): ReactNode {
  const {
    bezeichnung,
    spalten,
    daten,
    zeilenSchluessel,
    karte,
    form = 'auto',
    ladend,
    leerText,
    standardSortierung = null,
    sortierung,
    onSortierung,
    suche,
    gruppen,
    baum,
    zufluss = 'sammelbanner',
    spaltenAusVoreinstellung,
    spaltenAus,
    onSpaltenAus,
    zeilenKlasse,
    onZeileKlick,
    werkzeuge,
    aufklappen,
  } = props;

  const { token } = theme.useToken();
  const { abBreite } = useViewport();
  const wurzel = useRef<HTMLElement>(null);
  const werkzeugWurzel = useRef<HTMLDivElement>(null);

  /**
   * DIE ZEILENSCHLEUSE (Kriterium 12). Im Zustand `gefroren` hält `folge` die Schlüsselreihenfolge
   * beim Fokuseintritt; gerendert wird diese FOLGE, der Inhalt kommt frisch aus `daten`. Ein
   * Statuswechsel bleibt sofort sichtbar, die Zeile wandert nicht. (Die frischen Zeilen auf die
   * gefrorene Menge zu filtern gäbe den Überlebenden die NEUE Reihenfolge.)
   *
   * `gruppeVon` friert auch die GRUPPENZUGEHÖRIGKEIT ein: sonst hinge ein Live-Statuswechsel die
   * Karte unter einen anderen Gruppenkopf um. Bis zum Auftauen bleibt sie unter dem alten Kopf.
   *
   * Drei Zustände statt `readonly Key[] | null`: eine Zeile, die von SELBST wegrutscht, ist der
   * verbotene Sprung; eine Neuordnung, die der Benutzer angestoßen hat (Sortierklick, Suche,
   * Filter, Banner), muss sofort sichtbar sein. `'neu'` ist ein AUFTRAG, neu einzufrieren, den der
   * Layout-Effekt mit der neu geordneten Folge erfüllt. Das Einfrieren beim Fokuseintritt geschieht
   * SYNCHRON im Handler.
   */
  type Schleuse =
    | { art: 'offen' }
    | { art: 'neu' }
    | { art: 'gefroren'; folge: readonly Key[]; gruppeVon: ReadonlyMap<Key, string> };
  const [schleuse, setSchleuse] = useState<Schleuse>({ art: 'offen' });
  const gefroren = schleuse.art === 'gefroren' ? schleuse.folge : null;
  const gefroreneGruppeVon = schleuse.art === 'gefroren' ? schleuse.gruppeVon : null;

  const nachBenutzeraktion = useCallback(() => {
    setSchleuse((vorher) => (vorher.art === 'offen' ? vorher : { art: 'neu' }));
  }, []);

  // ── Zustand: Voreinstellung ODER kontrolliert, nie beides ──────────────────────────
  const [eigeneSortierung, setEigeneSortierung] = useState<Sortierung<K>>(standardSortierung);
  const aktiveSortierung = sortierung !== undefined ? sortierung : eigeneSortierung;
  const setzeSortierung = useCallback(
    (s: Sortierung<K>) => {
      if (sortierung === undefined) setEigeneSortierung(s);
      onSortierung?.(s);
      nachBenutzeraktion();
    },
    [sortierung, onSortierung, nachBenutzeraktion],
  );

  const [eigeneSpaltenAus, setEigeneSpaltenAus] = useState<readonly K[]>(
    spaltenAusVoreinstellung ?? [],
  );
  const aktiveSpaltenAus = spaltenAus ?? eigeneSpaltenAus;
  const setzeSpaltenAus = useCallback(
    (k: K[]) => {
      if (spaltenAus === undefined) setEigeneSpaltenAus(k);
      onSpaltenAus?.(k);
      // Eine Spaltenumschaltung IST eine Benutzeraktion: blendet man eine gefilterte Spalte aus, wird
      // ihr Filter unwirksam, und die freigegebenen Zeilen sind die Antwort auf den Klick, kein
      // Zufluss. Ohne diesen Aufruf zählte die Schleuse sie als neu. Greift nur für den eingebauten
      // Schalter (keine Seite nutzt den kontrollierten Weg).
      nachBenutzeraktion();
    },
    [spaltenAus, onSpaltenAus, nachBenutzeraktion],
  );

  // Per Breite weggefallene, von Hand zurückgeholte Spalten. Bewusst unkontrolliert, weil kein
  // Konsument diese Hälfte braucht.
  const [spaltenAn, setSpaltenAn] = useState<readonly K[]>([]);
  const setzeSpaltenAn = useCallback(
    (k: K[]) => {
      setSpaltenAn(k);
      // Aus demselben Grund wie oben: die freigegebenen Zeilen sind die Antwort auf den Klick.
      nachBenutzeraktion();
    },
    [nachBenutzeraktion],
  );

  const [suchbegriff, setSuchbegriff] = useState('');
  const [filterWerte, setFilterWerte] = useState<Record<string, readonly string[]>>({});
  const filterZuruecksetzen = useCallback(() => {
    setSuchbegriff('');
    setFilterWerte({});
    nachBenutzeraktion();
  }, [nachBenutzeraktion]);

  // ── Formwahl ──────────────────────────────────────────────────────────────────────
  // Steht HIER, weil die Ebenen-Registrierung darunter sie liest: der Spaltenschalter existiert
  // nur im Tabellenzweig.
  const alsTabelle = form === 'tabelle' || (form === 'auto' && abBreite('md'));

  const [spaltenOffen, setSpaltenOffen] = useState(false);

  // Steht der Schalter überhaupt? EINE Wahrheit für Palettenmeldung, Rücksetzer und Schalter.
  const spaltenSchalterDa = alsTabelle && hatWaehlbareSpalten(spalten);

  /*
   * Verschwindet der Schalter, feuert antd KEIN `onOpenChange(false)`; der kontrollierte Zustand
   * bliebe `true`, und das Overlay klappte beim Wiederauftauchen unaufgefordert auf. Der Riegel
   * hängt an Breite UND Spaltengarnitur.
   */
  useEffect(() => {
    if (!spaltenSchalterDa) setSpaltenOffen(false);
  }, [spaltenSchalterDa]);

  useTastaturEbene({
    name: `Datensicht-Filter: ${bezeichnung}`,
    wurzel: werkzeugWurzel,
    aktionen: {
      // Nur melden, was die Zeile auch hält; ein Befehl auf einen fehlenden Schalter wäre wirkungslos.
      'filter-zuruecksetzen': filterZuruecksetzen,
      ...(spaltenSchalterDa ? { spalten: () => setSpaltenOffen(true) } : {}),
    },
  });

  // ── Spaltensichtbarkeit ───────────────────────────────────────────────────────────
  // Steht VOR der Zeilenmenge, weil die wirksamen Filter davon abhängen (siehe unten).
  const verborgen = useMemo(() => new Set(aktiveSpaltenAus), [aktiveSpaltenAus]);
  const eingeblendet = useMemo(() => new Set(spaltenAn), [spaltenAn]);
  const { spalten: gezeigteSpalten } = useMemo(
    () => sichtbareSpalten({ spalten, verborgen, eingeblendet, abBreite }),
    [spalten, verborgen, eingeblendet, abBreite],
  );

  /**
   * WAS MAN NICHT SIEHT, WIRKT NICHT: nur Filter sichtbarer Spalten schneiden die Zeilenmenge. Sonst
   * behielte, wer eine gefilterte Spalte ausblendet, eine gefilterte Liste ohne sichtbaren Grund und
   * ohne Rückweg.
   *
   * Der Wert bleibt im Zustand und wirkt beim Wiedereinblenden erneut. Das gilt auch für Spalten,
   * die `abBreite` verbirgt: beim Verkleinern ändert sich die Zeilenzahl, bewusst, denn ein
   * unsichtbar wirkender Filter ist schlechter. Zähler und Filter folgen derselben Wahrheit.
   */
  const wirksameFilterWerte = useMemo(() => {
    const sichtbar = new Set(gezeigteSpalten.map((s) => s.key as string));
    return Object.fromEntries(Object.entries(filterWerte).filter(([k]) => sichtbar.has(k)));
  }, [filterWerte, gezeigteSpalten]);

  // ── Die Zeilenmenge ───────────────────────────────────────────────────────────────
  const zeilen = useMemo(
    () =>
      effektiveDaten({
        daten,
        spalten,
        sortierung: aktiveSortierung,
        suchbegriff,
        filterWerte: wirksameFilterWerte,
        gruppen,
        baum: baum != null,
      }),
    [daten, spalten, aktiveSortierung, suchbegriff, wirksameFilterWerte, gruppen, baum],
  );

  const schluessel = useCallback(
    (zeile: T) => schluesselVon(zeilenSchluessel, zeile),
    [zeilenSchluessel],
  );

  // ── Aufklappbereich ───────────────────────────────────────────────────────────────
  // EIN Zustand für beide Zweige: ein Wechsel zwischen Karte und Tabelle behält, was offen ist.
  const [aufgeklappt, setAufgeklappt] = useState<readonly Key[]>([]);
  const umschalten = useCallback(
    (k: Key) =>
      setAufgeklappt((jetzt) => (jetzt.includes(k) ? jetzt.filter((x) => x !== k) : [...jetzt, k])),
    [],
  );
  // IDs für `aria-controls`/`aria-labelledby` im Kartenzweig. Die Zeilenkennung hängt kodiert
  // dahinter; ein Schlüssel mit Leerzeichen (Funkrufname) zerbräche sonst die IDREF-Liste.
  const idPraefix = useId();
  const aufklappAusloeser = (zeile: T, mitRegion: boolean): ReactNode => {
    if (!aufklappen) return null;
    const k = schluessel(zeile);
    const offen = aufgeklappt.includes(k);
    return (
      <Button
        type="link"
        id={mitRegion ? `${idPraefix}-auf-${idTeil(k)}` : undefined}
        aria-expanded={offen}
        aria-controls={mitRegion && offen ? `${idPraefix}-bereich-${idTeil(k)}` : undefined}
        aria-label={aufklappen.zugaenglicherName(zeile)}
        // `bedienText`, die Rolle für blauen TEXT; seit LFH-652 wertgleich mit antds `colorLink`.
        style={{ color: rollenwerte(token).bedienText }}
        onClick={(e) => {
          // Die Tabelle darf den Klick nicht zusätzlich als Zeilenklick lesen.
          e.stopPropagation();
          umschalten(k);
        }}
        icon={
          // antds Ikone bringt `role="img"` mit englischem Namen mit; die Hülle nimmt sie aus dem
          // Vorlesebaum.
          <span aria-hidden="true" style={{ display: 'inline-flex' }}>
            {offen ? <IkoneChevronRunter /> : <IkoneChevronRechts />}
          </span>
        }
      >
        {aufklappen.etikett}
      </Button>
    );
  };

  const { sichtbareZeilen, zufluessig } = useMemo(() => {
    if (!gefroren) return { sichtbareZeilen: zeilen, zufluessig: 0 };
    const nachSchluessel = new Map(zeilen.map((z) => [schluessel(z), z]));
    const gefrorenMenge = new Set(gefroren);
    return {
      // Entfallene Schlüssel fallen sofort weg; die Schleuse hält nur Zuwachs zurück.
      sichtbareZeilen: gefroren
        .map((k) => nachSchluessel.get(k))
        .filter((z): z is T => z !== undefined),
      zufluessig: zeilen.filter((z) => !gefrorenMenge.has(schluessel(z))).length,
    };
  }, [gefroren, zeilen, schluessel]);

  /**
   * Erfüllt den `'neu'`-Auftrag mit `useLayoutEffect`: ein nachgelagerter Effekt ließe genau EINEN
   * Bildaufbau zwischen Benutzeraktion und erneutem Einfrieren, in dem ein Datenstand
   * durchrutschen könnte.
   */
  /**
   * Der eingefrorene Stand, Folge UND Gruppenzugehörigkeit. Beide Einfrierstellen (`'neu'`-Auftrag
   * und {@link betreten}) gehen hierdurch, damit keine die Gruppen vergisst.
   */
  const standJetzt = useCallback(
    (): { folge: readonly Key[]; gruppeVon: ReadonlyMap<Key, string> } => ({
      folge: zeilen.map(schluessel),
      gruppeVon: new Map(
        gruppen ? zeilen.map((z) => [schluessel(z), gruppen.schluessel(z)] as const) : [],
      ),
    }),
    [zeilen, schluessel, gruppen],
  );

  useLayoutEffect(() => {
    if (schleuse.art !== 'neu') return;
    setSchleuse({ art: 'gefroren', ...standJetzt() });
  }, [schleuse, standJetzt]);

  /**
   * DIE LEERE LADEANSICHT FRIERT NICHT EIN: wer den Fokus vor der ersten Antwort ins Suchfeld setzt,
   * fröre eine LEERE Folge ein, und die erste Lieferung landete hinter dem Sammelbanner. Ohne
   * gerenderte Zeile kann nichts unter dem Cursor wegrutschen.
   *
   * Nicht auf `ladend` gaten: ein Query, der auf `[]` auflöst und per SSE nachbekommt, hat
   * `ladend === false` bei leerer Menge. `zeilen` ist die ehrliche Quelle. Der `'neu'`-Pfad braucht
   * die Bedingung nicht: {@link nachBenutzeraktion} ist aus `'offen'` ein No-op.
   *
   * Bleibt der Fokus nach dem Eintreffen in der Werkzeugzeile, ist die Schleuse offen, bis zum
   * nächsten Fokuseintritt (`focusin` bubbelt, der Sprung Suchfeld → Zeilenlink genügt). Ein
   * Einfrieren beim ersten Datenstand fröre ausgerechnet die erwartete Lieferung ein.
   */
  const betreten = useCallback(() => {
    if (zufluss !== 'sammelbanner') return;
    if (zeilen.length === 0) return;
    // SYNCHRON im Handler: die jetzt sichtbare Folge ist die richtige.
    setSchleuse((vorher) =>
      vorher.art === 'offen' ? { art: 'gefroren', ...standJetzt() } : vorher,
    );
  }, [zufluss, zeilen.length, standJetzt]);

  /**
   * `focusout` feuert auch beim Sprung von der Titelzelle zum Aktionsknopf derselben Sicht; ohne
   * `contains`-Prüfung taute die Schleuse genau beim Bedienen auf.
   */
  const pruefeVerlassen = useCallback((ziel: EventTarget | null) => {
    if (ziel != null && wurzel.current?.contains(ziel as Node)) return;
    /**
     * EIN ÜBERLAGERNDES MENÜ IST KEIN VERLASSEN. Menüs (Statuswahl, `weitere`) liegen in einem PORTAL
     * an `document.body`, und antds `autoFocus` schiebt den Fokus dorthin; ohne diesen Zweig taute
     * die Schleuse, während jemand das Menü offen hält.
     *
     * In jsdom bleibt der Fokus beim Öffnen auf dem Auslöser: ein Test, der nur ein Menü öffnet, ist
     * auch ohne diesen Zweig grün. Geprüft wird der Handler direkt, mit `relatedTarget` im Portal.
     * Erkennung über antds Overlay-Klassen, weil die Overlays keinem Knoten dieser Sicht gehören.
     */
    if (
      ziel instanceof Node &&
      (ziel as Element).closest?.('.ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown')
    ) {
      return;
    }
    setSchleuse({ art: 'offen' });
  }, []);

  // ── DEV-Diagnose ──────────────────────────────────────────────────────────────────
  /**
   * `useMemo` über die Eingaben, Effekt über einen PRIMITIVEN Schlüssel: die Aufrufer bauen
   * Kartenplan und Spaltenliste je Render neu, ein Effekt über die Objekte flutete die Konsole.
   */
  const befunde = useMemo(
    () =>
      pruefeKartenplan(
        { spalten, karte, suche, baum, gruppen, aufklappen, onZeileKlick },
        bezeichnung,
      ),
    [spalten, karte, suche, baum, gruppen, aufklappen, onZeileKlick, bezeichnung],
  );
  const befundSchluessel = befunde.join(' | ');
  useEffect(() => {
    if (!import.meta.env.DEV || befundSchluessel === '') return;
    console.warn(`[Datensicht: ${bezeichnung}] ${befundSchluessel}`);
  }, [befundSchluessel, bezeichnung]);

  // ── Werkzeugzeile ─────────────────────────────────────────────────────────────────
  const filterSpalten = gezeigteSpalten.filter((s) => s.filter != null);
  /**
   * Gruppiert wird über die EINGEFRORENE Achse, solange die Schleuse zu ist. Der Rückfall auf die
   * frische Achse gilt nur für Zeilen, die beim Einfrieren nicht dabei waren; eine Zeile mit
   * GEÄNDERTEM Gruppenwert behält ihren alten Eimer.
   */
  const gruppenAchse = useMemo(() => {
    if (!gruppen || !gefroreneGruppeVon) return gruppen;
    return {
      ...gruppen,
      schluessel: (zeile: T) =>
        gefroreneGruppeVon.get(schluessel(zeile)) ?? gruppen.schluessel(zeile),
    };
  }, [gruppen, gefroreneGruppeVon, schluessel]);
  /**
   * ZWEI Gruppierungen: `gruppenKarten` (gefrorene Achse) ordnet im Kartenzweig Karten den Köpfen
   * zu, dort ist die Gruppe eine POSITION. `gruppenZaehler` (frische Achse) speist den
   * Zählerstreifen des Tabellenzweigs, dort ist sie eine ZAHL und muss sofort stimmen.
   */
  const gruppenZaehler = gruppen ? gruppiere(sichtbareZeilen, gruppen) : [];
  const gruppenKarten = gruppenAchse ? gruppiere(sichtbareZeilen, gruppenAchse) : [];

  const werkzeugzeile =
    (
      /**
       * IMMER gerendert, auch leer: eine Zeile, die erst beim Eintreffen erscheint, verschiebt Inhalt.
       * AUSSERHALB des Tabellenrahmens, weil `katalogtabelle-schmal.spec.ts` die Bildlaufbreite an
       * dessen Wurzel misst.
       */
      <div
        ref={werkzeugWurzel}
        data-lfh="datensicht-werkzeuge"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: token.paddingSM,
          marginBlockEnd: token.marginXS,
          minHeight: token.controlHeight,
        }}
      >
        {werkzeuge}
        {suche != null && baum == null && (
          // Ein nacktes `<input type="search">` statt `Input.Search`: `KatalogTabelle` bekommt hier keine
          // `suche`, zwei Felder wären die Folge. Höhe aus `controlHeight`, fluide Breite.
          <input
            type="search"
            aria-label={`Suche in ${bezeichnung}`}
            placeholder={suche.platzhalter}
            value={suchbegriff}
            onChange={(e) => {
              setSuchbegriff(e.target.value);
              nachBenutzeraktion();
            }}
            style={{
              height: token.controlHeight,
              width: '100%',
              maxWidth: 220,
              paddingInline: token.paddingSM,
              border: `1px solid ${token.colorBorder}`,
              borderRadius: token.borderRadius,
              background: token.colorBgContainer,
              color: token.colorText,
              fontSize: token.fontSize,
            }}
          />
        )}
        {baum == null &&
          filterSpalten.map((spalte) => (
            <Select
              key={spalte.key}
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              aria-label={etikettVon(spalte) ?? spalte.key}
              placeholder={etikettVon(spalte) ?? spalte.key}
              value={[...(filterWerte[spalte.key] ?? [])]}
              onChange={(werte: string[]) => {
                setFilterWerte((vorher) => ({ ...vorher, [spalte.key]: werte }));
                nachBenutzeraktion();
              }}
              options={spalte.filter!.werte.map((w) => ({ value: w.value, label: w.text }))}
              style={{ minWidth: 160 }}
            />
          ))}
        {alsTabelle && (
          <SpaltenSchalter
            bezeichnung={bezeichnung}
            spalten={spalten}
            aus={aktiveSpaltenAus}
            onAus={setzeSpaltenAus}
            an={spaltenAn}
            onAn={setzeSpaltenAn}
            offen={spaltenOffen}
            onOffen={setSpaltenOffen}
          />
        )}
        {gruppenZaehler.length > 0 && alsTabelle && (
          <Space size={token.paddingXS} wrap>
            {gruppenZaehler.map((g) => (
              <Typography.Text key={g.wert} type="secondary">
                {g.etikett} · {g.zeilen.length}
              </Typography.Text>
            ))}
          </Space>
        )}
        {zufluessig > 0 && (
          // Sammelbanner statt eingeschobener Zeilen (WCAG 3.2.5). Kein `danger`: Rot bedient nichts.
          <Button type="primary" onClick={nachBenutzeraktion}>
            {zufluessig === 1 ? '1 neuer Eintrag' : `${zufluessig} neue Einträge`} — anzeigen
          </Button>
        )}
      </div>
    );

  // ── Tabellenzweig ─────────────────────────────────────────────────────────────────
  /**
   * Die Spaltenliste wird vor der Übergabe verändert: `abBreite` streicht Spalten, hier kommt
   * `sorter: true` samt kontrollierter Richtung dazu („extern sortiert“, antd zeichnet nur den
   * Pfeil).
   *
   * `mindestBreite` wird ABSICHTLICH nicht herausgelöst: `KatalogTabelle` braucht die Fließmarke
   * für seine Breitenrechnung. Die Zieltypisierung als {@link KatalogSpalte} macht das Durchreichen
   * sichtbar; als `TableColumnsType` fiele das Feld still weg.
   */
  const antdSpalten = useMemo<KatalogSpalte<T>[]>(
    () =>
      gezeigteSpalten.map((spalte) => {
        const {
          etikett,
          sortWert,
          suchText,
          filter,
          abBreite: _ab,
          immerSichtbar,
          ...antd
        } = spalte;
        void etikett;
        void suchText;
        void filter;
        void _ab;
        void immerSichtbar;
        const gebaut: KatalogSpalte<T> = { ...antd };

        /**
         * Der Titel-Link steht in BEIDEN Zweigen, als Tastatur- und Berührungsziel der Zeile. Trägt
         * `titel.ziel` einen Wert, darf das `render` dieser Spalte keinen Anker erzeugen.
         */
        if (karte.art === 'plan' && karte.titel.ziel && spalte.key === karte.titel.spalte) {
          const ziel = karte.titel.ziel;
          gebaut.render = (_wert, zeile, index) => {
            const nach = ziel(zeile);
            const stil = {
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: token.controlHeight,
            } as const;
            return nach == null ? (
              <span style={stil}>{zelle(spalte, zeile, index)}</span>
            ) : (
              <Link to={nach} style={stil}>
                {zelle(spalte, zeile, index)}
              </Link>
            );
          };
        }

        if (!sortWert) return gebaut;
        // `sorter: true` heißt für antd „extern sortiert“: nur der Pfeil, sortiert wird in
        // `effektiveDaten`.
        return {
          ...gebaut,
          sorter: true,
          sortOrder:
            aktiveSortierung?.spalte === spalte.key
              ? aktiveSortierung.richtung === 'auf'
                ? ('ascend' as const)
                : ('descend' as const)
              : null,
        };
      }),
    [gezeigteSpalten, aktiveSortierung, karte, token.controlHeight],
  );

  /**
   * Mit `aufklappen` trägt die KENNUNGSZELLE den Auslöser, keine eigene Aufklappspalte: hinter der
   * fixierten Kennung glitt eine solche Spalte bei 390 px unter sie (Gate 1), an Position 0 erbte
   * sie deren `fixed`. Die Kennungszelle ist immer sichtbar, wie in der Karte.
   */
  const ersteSpalte = gezeigteSpalten[0];
  const tabellenSpalten: KatalogSpalte<T>[] =
    aufklappen && antdSpalten.length > 0 && ersteSpalte
      ? [
          {
            ...antdSpalten[0],
            render: (wert: unknown, zeile: T, index: number) => {
              const basis = antdSpalten[0].render;
              // Der Titel-Link ersetzt das Spalten-`render`; sonst die Zelle über `zelle`.
              const inhalt =
                basis && basis !== ersteSpalte.render
                  ? (basis(wert, zeile, index) as ReactNode)
                  : zelle(ersteSpalte, zeile, index);
              return (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: token.marginXXS,
                  }}
                >
                  {inhalt}
                  {aufklappAusloeser(zeile, false)}
                </div>
              );
            },
          },
          ...antdSpalten.slice(1),
        ]
      : antdSpalten;

  const tabelle = (
    <KatalogTabelle<T>
      columns={tabellenSpalten}
      dataSource={[...sichtbareZeilen]}
      rowKey={(zeile) => schluessel(zeile)}
      loading={ladend}
      locale={leerText != null ? { emptyText: leerText } : undefined}
      // Keine Suche und keine Blätterung von `KatalogTabelle`: die Suche steht in der Werkzeugzeile,
      // eine Seitenblätterung schnitte die Zeilenschleuse entzwei.
      pagination={false}
      rowClassName={zeilenKlasse ? (zeile) => zeilenKlasse(zeile) ?? '' : undefined}
      /**
       * DER ANKER BEDIENT DEN KLICK ALLEIN (LFH-340). Eine Zeile trägt echte `<a>` (Titel-Link,
       * Deeplinks aus Spalten-`render`); ohne Riegel feuerten bei einem Klick Link UND `onZeileKlick`.
       * Beim Modifier-Klick öffnete der Link den neuen Tab, und die aktuelle Seite navigierte trotzdem
       * weg. Der Riegel sitzt hier statt an jedem Link, weil die Konsumenten den Titel-Link gar nicht
       * selbst bauen.
       */
      onRow={
        onZeileKlick
          ? (zeile) => ({
              onClick: (event) => {
                if ((event.target as HTMLElement).closest('a')) return;
                onZeileKlick(zeile);
              },
            })
          : baum
            ? (zeile) => ({
                /**
                 * Derselbe Riegel für den Baum (LFH-548): die ganze Zeile klappt auf, außer der
                 * Klick galt einem Bedienziel der Zeile oder kam aus einem Portal. antds
                 * `expandRowByClick` kennt keinen Riegel: ein Klick auf den Titel-Link klappte
                 * sonst mit um, beim Strg-Klick sogar in der Seite, die stehen bleibt; ein
                 * Statusknopf klappte die Einheit zu, während sein Menü aufging. Das
                 * Aufklappsymbol selbst stoppt die Weitergabe (rc-table, im Test gepinnt).
                 */
                onClick: (event) => {
                  const ziel = event.target as HTMLElement;
                  // Ein React-Portal (Menü eines Zeilenknopfs) reicht seinen Klick an die Zeile
                  // weiter, liegt im DOM aber woanders: er gehört nicht der Zeile.
                  if (!event.currentTarget.contains(ziel)) return;
                  // Eigene Bedienziele in der Zeile (Link, Knopf, Feld) bedienen den Klick allein.
                  if (ziel.closest('a, button, input, select, textarea, [role="button"]')) return;
                  const kinder = zeile[baum.kinder] as readonly T[] | undefined;
                  if (!kinder || kinder.length === 0) return;
                  const k = schluessel(zeile);
                  baum.onAufgeklappt(
                    baum.aufgeklappt.includes(k)
                      ? baum.aufgeklappt.filter((x) => x !== k)
                      : [...baum.aufgeklappt, k],
                  );
                },
              })
            : undefined
      }
      /**
       * Sortieren ist hier der EINZIGE Auslöser von `onChange`, also darf es die Sortierung auch
       * LÖSCHEN: antds Zyklus endet mit `columnKey === undefined`, und ein früher Rücksprung darauf
       * ließe die Tabelle für immer absteigend.
       */
      onChange={(_seite, _filter, sorter) => {
        const einzeln = Array.isArray(sorter) ? sorter[0] : sorter;
        if (einzeln == null) return;
        const spalte = einzeln.columnKey as K | undefined;
        if (einzeln.order == null || spalte == null) {
          setzeSortierung(null);
          return;
        }
        setzeSortierung({ spalte, richtung: einzeln.order === 'ascend' ? 'auf' : 'ab' });
      }}
      expandable={
        baum
          ? {
              childrenColumnName: baum.kinder,
              expandedRowKeys: [...baum.aufgeklappt],
              onExpandedRowsChange: (schluessel) => baum.onAufgeklappt([...schluessel]),
              // Die ganze Zeile ist das Trefferziel, nicht das ~16 px breite Symbol (antd zeichnet es in fester
              // Größe). Im Primitiv, damit es für jeden Baum gilt; `onZeileKlick` ist im Baummodus gesperrt.
              // Nicht über antds `expandRowByClick`, sondern über `onRow` oben: nur dort sitzt der
              // Anker-Riegel (LFH-548).
              expandRowByClick: false,
            }
          : aufklappen
            ? {
                expandedRowKeys: [...aufgeklappt],
                expandedRowRender: (zeile) => aufklappen.inhalt(zeile),
                // KEINE eigene Aufklappspalte: der Auslöser steht in der Kennungszelle.
                showExpandColumn: false,
              }
            : undefined
      }
    />
  );

  // ── Kartenzweig ───────────────────────────────────────────────────────────────────
  const kartenEintrag = (zeile: T, index: number, tiefe: number): ReactNode => {
    if (karte.art === 'eigen') {
      return karte.render({ zeile, index, tiefe });
    }
    const titelSpalte = spalten.find((s) => s.key === karte.titel.spalte);
    const titelInhalt = titelSpalte ? zelle(titelSpalte, zeile, index) : null;
    const ziel = karte.titel.ziel?.(zeile);
    const status = karte.status?.(zeile) ?? null;
    const statusBedienung = karte.statusBedienung?.(zeile) ?? null;
    const felder = (karte.sekundaer ?? [])
      .filter((k): k is K => k != null)
      .map((k) => spalten.find((s) => s.key === k))
      .filter((s): s is DatensichtSpalte<T, K> => s != null);
    const aktion = karte.aktion;
    const zeigeAktion = aktion != null && (aktion.sichtbar?.(zeile) ?? true);

    const knopf = zeigeAktion ? (
      // Kein `size`-Prop und kein `danger`: die Höhe kommt aus `controlHeight`, Rot bedient nichts.
      // Die Rückfrage ist der zweite Handgriff aus Kriterium 4.
      aktion!.bestaetigung != null ? (
        <Popconfirm
          key="aktion"
          title={aktion!.bestaetigung}
          onConfirm={() => aktion!.onKlick(zeile)}
          okButtonProps={aktion!.bestaetigungGefahr ? { danger: true } : undefined}
        >
          <Button aria-label={aktion!.zugaenglicherName?.(zeile)}>{aktion!.etikett}</Button>
        </Popconfirm>
      ) : (
        <Button
          key="aktion"
          aria-label={aktion!.zugaenglicherName?.(zeile)}
          onClick={() => aktion!.onKlick(zeile)}
        >
          {aktion!.etikett}
        </Button>
      )
    ) : null;

    const weitere = karte.weitere;
    // Vorab ausgewertet: `aktionen.length` entscheidet unten über die Aktionsleiste, und ein
    // Baustein, der `null` rendert, zählte dort mit.
    const weitereEintraege = weitere?.eintraege(zeile) ?? [];
    const weitereLaeuft = weitere?.laeuft?.(zeile) ?? false;
    const menueKnopf =
      weitere && weitereEintraege.length > 0 ? (
        <MenueAusloeser
          key="weitere"
          eintraege={weitereEintraege}
          zugaenglicherName={weitere.zugaenglicherName(zeile)}
          // Eine laufende Aktion sperrt den Auslöser und zeigt sich an ihm (LFH-654).
          gesperrt={weitereLaeuft}
          laeuft={weitereLaeuft}
          onWahl={(key) => weitere.onWahl(key, zeile)}
        />
      ) : null;
    const aktionen = [knopf, menueKnopf].filter((k) => k != null);

    return (
      <div
        data-lfh="datensicht-karte"
        className={zeilenKlasse?.(zeile)}
        style={{ paddingInlineStart: token.padding * Math.min(tiefe, TIEFE_DECKEL) }}
      >
        <ListenEintrag actions={aktionen.length > 0 ? aktionen : undefined}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: token.marginXS,
                flexWrap: 'wrap',
              }}
            >
              {ziel != null ? (
                // Das Tastaturziel der Zeile: ein echter Link mit Höhe aus `controlHeight`.
                <Link
                  to={ziel}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    minHeight: token.controlHeight,
                    fontWeight: 600,
                  }}
                >
                  {titelInhalt}
                </Link>
              ) : (
                <Typography.Text strong>{titelInhalt}</Typography.Text>
              )}
              {/* Das Statusetikett ist der Auslöser, wenn es einen Bedienweg gibt, sonst Anzeige. Kein
                  `Select`: seine feste Mindestbreite drückte die 390-px-Karte breit, das Menü liegt im
                  Portal. */}
              {statusBedienung ? (
                <StatusWahl
                  darstellung={status}
                  farbe={statusBedienung.farbe}
                  aktuell={statusBedienung.aktuell}
                  optionen={statusBedienung.optionen}
                  kennung={statusBedienung.kennung}
                  onWaehlen={statusBedienung.onWaehlen}
                  laeuft={statusBedienung.laeuft}
                  gesperrt={statusBedienung.gesperrt}
                  darfSchreiben
                />
              ) : (
                status && <StatusTag darstellung={status} />
              )}
            </div>
            {felder.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: token.padding }}>
                {felder.map((spalte) => (
                  <span
                    key={spalte.key}
                    data-lfh="datensicht-feld"
                    style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0 }}
                  >
                    {/* Feldetikett als Augenbraue, Versalien per CSS; der Wortlaut im DOM bleibt. */}
                    <Augenbraue>{etikettVon(spalte) ?? spalte.key}</Augenbraue>
                    <span style={spalte.zahl ? monoStil(token.fontSize) : undefined}>
                      {zelle(spalte, zeile, index)}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {aufklappen && <div>{aufklappAusloeser(zeile, true)}</div>}
          </div>
        </ListenEintrag>
        {/* Der Bereich steht UNTER der Karte in voller Breite, sonst zöge er die Aktionsleiste von
            `ListenEintrag` in die Mitte und nähme ihr bei 390 px die Breite. */}
        {aufklappen && aufgeklappt.includes(schluessel(zeile)) && (
          <div
            id={`${idPraefix}-bereich-${idTeil(schluessel(zeile))}`}
            role="region"
            aria-labelledby={`${idPraefix}-auf-${idTeil(schluessel(zeile))}`}
          >
            {aufklappen.inhalt(zeile)}
          </div>
        )}
      </div>
    );
  };

  /**
   * Rekursion für den Kartenzweig mit gesetztem `baum`: der Weg, auf dem eine NICHT vergleichende
   * Baumfläche Karten bekommt. Die Einrückung wächst bis {@link TIEFE_DECKEL}.
   */
  const baumEintrag = (zeile: T, index: number, tiefe: number): ReactNode => {
    const kinder = (zeile[baum!.kinder as keyof T] as readonly T[] | undefined) ?? [];
    const eigener = schluessel(zeile);
    const offen = baum!.aufgeklappt.includes(eigener);
    return (
      <div key={eigener}>
        {kartenEintrag(zeile, index, tiefe)}
        {kinder.length > 0 && (
          <div style={{ paddingInlineStart: token.padding * Math.min(tiefe + 1, TIEFE_DECKEL) }}>
            <Button
              type="link"
              onClick={() =>
                baum!.onAufgeklappt(
                  offen
                    ? baum!.aufgeklappt.filter((k) => k !== eigener)
                    : [...baum!.aufgeklappt, eigener],
                )
              }
            >
              {offen
                ? `${kinder.length} Untereinträge verbergen`
                : `${kinder.length} Untereinträge`}
            </Button>
          </div>
        )}
        {offen && kinder.map((kind, i) => baumEintrag(kind, i, tiefe + 1))}
      </div>
    );
  };

  const kartenListe = (zeilenMenge: readonly T[], kopf?: ListenKopf) => (
    <Liste
      dataSource={zeilenMenge}
      rowKey={(zeile) => schluessel(zeile)}
      kopf={kopf}
      loading={ladend}
      // `emptyText` statt eines eigenen Leerzustands-Knotens.
      emptyText={leerText}
      renderItem={(zeile, index) =>
        baum ? baumEintrag(zeile, index, 0) : kartenEintrag(zeile, index, 0)
      }
    />
  );

  const kartenZweig =
    gruppen && !baum ? (
      <>
        {gruppenKarten.map((g) => (
          <div key={g.wert}>
            {kartenListe(g.zeilen, {
              inhalt: (
                <Typography.Text strong>
                  {g.etikett} · {g.zeilen.length}
                </Typography.Text>
              ),
              unterEbene: gruppen.unterEbene,
            })}
          </div>
        ))}
        {gruppenKarten.length === 0 && kartenListe([])}
      </>
    ) : (
      kartenListe(sichtbareZeilen)
    );

  return (
    <section
      ref={wurzel}
      aria-label={bezeichnung}
      onFocus={betreten}
      onBlur={(e) => pruefeVerlassen(e.relatedTarget)}
    >
      {werkzeugzeile}
      {/* GENAU EIN Zweig im Baum, kein Umschalten per verborgener Fläche. */}
      {alsTabelle ? tabelle : kartenZweig}
    </section>
  );
}
