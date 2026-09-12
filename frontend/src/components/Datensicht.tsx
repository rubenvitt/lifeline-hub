import { Button, Checkbox, Dropdown, Popconfirm, Space, Typography, theme } from 'antd';
import type { Key, ReactNode } from 'react';
import type { TableColumnType } from 'antd';
import {
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import KatalogTabelle, { type KatalogSpalte } from './KatalogTabelle';
import { Liste, ListenEintrag } from './Liste';
import { Select } from './Select';
import StatusTag from './StatusTag';
import StatusWahl, { type StatusBedienung } from './StatusWahl';
import { useViewport, type AbBreitePunkt } from './useViewport';
import type { StatusDarstellung } from '../theme/statusFarben';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';

/**
 * Datensicht-Primitiv der Einsatzmodule (LFH-330 · B2).
 *
 * EINE Spaltendefinition je Modul, zwei Darstellungsformen. Die Formwahl liegt an
 * `form`, nicht am Zufall: `'tabelle'` immer Tabelle, `'karte'` immer Karte,
 * `'auto'` Tabelle ab `tabelleAb` (Default `md`) und Karte darunter. Der Tabellenzweig rendert nicht selbst,
 * sondern durch `KatalogTabelle` — es bleibt bei EINER Scroll-/Sticky-/Fixier-Wahrheit
 * im Repo, und diese Datei setzt kein Bildlauf-Prop.
 *
 * ── DIE KARTEN-AUSNAHME, und sie ist begründungspflichtig ───────────────────────
 *
 * `form: 'auto'` löst unterhalb `md` eine Tabelle in Karten auf. Das WIDERSPRICHT der
 * Regel aus CLAUDE.md und A1/Festlegung 2: „Auf schmalem Schirm wird eine Tabelle
 * angepasst, nicht in Karten aufgelöst — Karten-Fallback ist die Ausnahme mit
 * Begründung im Task."
 *
 * Träger der Ausnahme ist der Kontext **mobil** aus A1: ~390 px, einhändig, komfortabel,
 * keine Vergleichsansichten. Dort ist ein Datensatz, der als EINHEIT erfasst und gelesen
 * wird — ein Fahrzeug, eine Person, eine Bewegung — keine Vergleichsaufgabe, und
 * Festlegung 2 sagt für diesen Fall „Liste/Karte, wenn gelesen wird".
 *
 * DIE TRENNLINIE, damit die Ausnahme nicht wandert:
 *   · `KatalogTabelle` + Bildlauf bleibt für die Stammdaten-VERGLEICHSTABELLEN. Keine der
 *     dreizehn wird zu Karten, keine ihrer Aufrufstellen wird angefasst.
 *   · `form: 'tabelle'` gilt für Vergleichsflächen, die auch schmal verglichen werden —
 *     das Meldebild der Kräfteübersicht, das A1/Festlegung 2 namentlich als „wird
 *     verglichen: ja" führt. Prüflisten-Kriterium 14 verbietet dort die Auflösung in
 *     Karten ausdrücklich; das ist kein Ermessen.
 *   · `form: 'auto'` gilt für Einsatzmodule, in denen ein Datensatz eine Einheit ist.
 *   · `form: 'karte'` gilt für Module, die heute schon kartenbasiert gelesen werden
 *     (Befehle, Lageberichte). Dort ist die Tabelle der Befund, nicht der Zielzustand.
 *
 * Was die Karte NICHT kann, ist an der Aufrufstelle sichtbar statt still: `aufklappzeile`
 * läuft nur im Tabellenzweig, und eine Spalte ohne Platz im Kartenplan erscheint dort
 * nicht. Der Funktionsverlust unter `md` ist damit lesbar, nicht überraschend.
 *
 * ── FÜNF ZUSICHERUNGEN, sie gehören dem Primitiv ────────────────────────────────
 *
 * 1. **Genau EIN Zweig im Baum.** Kein Umschalten per verborgener Fläche. Ein zweiter,
 *    verborgener Zweig machte jedes „unter md keine Tabelle"-Gate bedeutungslos und
 *    montierte die In-Zeile-Steuerelemente doppelt — die Lehre aus dem Navigations-Drawer
 *    (B1), der seinen Inhalt deshalb erst beim Öffnen rendert.
 * 2. **EINE Reihenfolge, EINE Menge für beide Zweige.** Antds Sortier- und Filterhaken
 *    sind am Spaltentyp abgeschnitten, weil `Table` deren Zustand INTERN hält: der
 *    Kartenzweig könnte ihn nicht lesen und zeigte still eine andere Reihenfolge.
 *    Sortiert und gefiltert wird hier, die Tabelle bekommt nur den Pfeil und dessen
 *    kontrollierte Richtung.
 * 3. **EINE Sichtbarkeitswahrheit.** `abBreite` ersetzt antds Breiten-Prop, das
 *    Verbergen-Flag ist gestrichen, und beide Ausblendungsgründe fließen in DENSELBEN
 *    Zähler. Ein Zähler, der „0 ausgeblendet" meldet, während antd zwei Spalten verbirgt,
 *    verfehlt genau das Kriterium (14), für das er existiert.
 * 4. **Das Tastaturziel der Zeile ist die Titelzelle, nicht die Fläche.** Bei gesetztem
 *    `titel.ziel` rendert sie in BEIDEN Zweigen einen echten `<Link>` mit Höhe aus
 *    `controlHeight`. Grund: `ListenEintrag` (`components/Liste.tsx`) legt `onClick` auf
 *    ein nacktes `<div>` — ohne `role`, ohne `tabIndex`, ohne `onKeyDown`. Ein Zeilenklick
 *    darauf wäre maus-/tippgebunden und für die Trefflächenmessung unsichtbar. Eine
 *    klickbare Karte als Ganzes gehört B7 (LFH-335) samt `Liste.tsx`.
 * 5. **Zeilen springen nicht unter dem Cursor.** Solange der Fokus in der Sicht liegt,
 *    sind Zeilenmenge und -reihenfolge eingefroren; Zellinhalte laufen weiter. Zufluss
 *    erscheint als Banner in der Werkzeugzeile (WCAG 3.2.5 / G76, CLS ≤ 0,1). Die
 *    Werkzeugzeile wird IMMER gerendert, auch leer — eine Zeile, die beim Eintreffen
 *    erscheint, verschiebt Inhalt und arbeitet gegen ihr eigenes Ziel.
 *
 * ── VIER FALLEN ────────────────────────────────────────────────────────────────
 *
 * · **Die Werkzeugzeile liegt AUSSERHALB des Tabellenrahmens.** `katalogtabelle-schmal.spec.ts`
 *   misst die Bildlaufbreite am Tabellenwurzelknoten gegen 390 px; eine Leiste darin
 *   zählte in dieses Maß hinein und machte die Messung stumpf.
 * · **`const K` ist verlierbar.** Wer die Spaltenliste ANNOTIERT statt sie durch
 *   `spaltenFuer<T>()` zu führen, weitet `K` auf `string`; der Kartenplan nimmt danach
 *   jeden Tippfehler ohne Meldung an. Deshalb prüft {@link pruefeKartenplan} die
 *   Slot-Schlüssel im DEV-Effekt gegen die echten Spaltenschlüssel, und der Guard
 *   verlangt die Marke `spaltenFuer` je Konsumentendatei.
 * · **Der Statusslot ist NICHT das `render` der Statusspalte.** Dort steht im
 *   Schreibmodus ein Auswahlfeld mit fester Mindestbreite, das eine 390-px-Karte breit
 *   drückt. Der Slot nimmt eine `StatusDarstellung` — `label` ist dort Pflichtfeld und
 *   damit der zweite Kanal (WCAG 1.4.1).
 * · **Filter, Suche und Gruppen sind im Baummodus VERBOTEN, nicht bloß unbenutzt.**
 *   Die Aggregate der Elternzeilen des Meldebilds sind stromaufwärts über die VOLLMENGE
 *   kumuliert (`kraefte/kraeftebild.ts`, `addKategorie`). Fiele hier eine Zeile weg,
 *   behielten die Eltern Zahlen über nicht mehr sichtbare Kinder — sie lügen still, und
 *   kein Test sieht es. Vorgefiltert wird stromaufwärts (`filtereKraefte`).
 */

// ── Formachse ────────────────────────────────────────────────────────────────────────
/**
 * `'auto'` Tabelle ab `tabelleAb` (Default `md`), Karte darunter — begründungspflichtig.
 * `'tabelle'` immer Tabelle. Für Vergleichsflächen (Meldebild), die Kriterium 14
 *            ausdrücklich nicht in Karten auflösen dürfen.
 * `'karte'` immer Karte. Für Module, die heute schon kartenbasiert gelesen werden
 *            (Befehle, Lageberichte) — dort ist die Tabelle der Befund, nicht das Ziel.
 */
export type Darstellungsform = 'auto' | 'tabelle' | 'karte';

// ── Spaltenregister ──────────────────────────────────────────────────────────────────
/**
 * Was dem Primitiv gehört und der Aufrufer nicht setzen darf. Muster `KatalogTabelle`.
 *
 * Die antd-Sortier- und Filterhaken gehören `Datensicht`: antd hält deren Zustand INTERN,
 * der Kartenzweig könnte ihn nicht lesen und zeigte still eine andere Reihenfolge und
 * Menge. Gemessen tut das im Bestand niemand, die Amputation kostet also keinen Bestand.
 * `fixed` gehört `KatalogTabelle`. Antds Breiten-Prop und sein Verbergen-Flag sind
 * gestrichen und durch {@link DatensichtSpalte.abBreite} bzw. den Spaltenschalter
 * ersetzt — beide würden sonst Spalten verbergen, die der Zähler nicht kennt, und ein
 * Zähler, der lügen kann, verfehlt Kriterium 14.
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
   * Diese Spalte FLIESST im Tabellenzweig: sie nimmt den Rest der Breite und bricht um,
   * statt die Tabelle zu verbreitern (LFH-523). Wert ist ihr Mindestmaß in px.
   *
   * Durchgereicht an {@link KatalogSpalte.mindestBreite} — EIN Begriff, zwei Träger, wie
   * bei `suchText`. Im KARTENZWEIG wirkungslos und das mit Absicht: eine Karte ist so breit
   * wie ihre Fläche, dort bricht der Text ohnehin um. Genau deshalb war der Befund von
   * LFH-523 ein reiner Tabellenbefund.
   */
  mindestBreite?: number;
  /** Nicht abwählbar (Aktionsspalte). Spalte 0 ist es immer, unabhängig vom Flag. */
  immerSichtbar?: boolean;
};

/**
 * Bewahrt die Schlüssel-Literale, ohne die T-Angabe zu verlieren. Curried, weil TypeScript
 * keine teilweise Typargument-Inferenz kennt.
 *
 * FALLE: eine Liste, die als `readonly DatensichtSpalte<Person>[]` ANNOTIERT wird, weitet
 * `K` auf `string` und der Kartenplan nimmt danach jeden Tippfehler an. Der Typ kann das
 * nicht schließen; geschlossen wird es zweifach — {@link pruefeKartenplan} im DEV-Effekt
 * und die Guard-Marke `spaltenFuer` je Konsumentendatei.
 */
export function spaltenFuer<T extends object>(): <const K extends string>(
  spalten: readonly DatensichtSpalte<T, K>[],
) => readonly DatensichtSpalte<T, K>[] {
  return (spalten) => spalten;
}

// ── Kartenplan ───────────────────────────────────────────────────────────────────────
/**
 * GENAU EINE Primäraktion — als Deskriptor, nicht als `ReactNode`-Slot. Damit besitzt das
 * Primitiv Form, Höhe (`controlHeight`) und Trefffläche; eine Klein-Variante oder ein
 * Gefahren-Anstrich sind von außen nicht einschmuggelbar („Rot bedient nichts").
 *
 * `bestaetigung` ist nicht Zierde: die drei Bestands-„Entfernen" (Fahrzeuge, Personal,
 * Material) hängen an einer Rückfrage. Ohne dieses Feld feuerte die Aktion im Kartenzweig
 * ohne Rückfrage — Prüflisten-Kriterium 4.
 */
export interface PrimaerAktion<T> {
  etikett: string;
  onKlick: (zeile: T) => void;
  /** Rückfragetitel. Gesetzt ⇒ Rückfrage vor dem Auslösen, ohne Gefahren-Anstrich. */
  bestaetigung?: string;
  /** Zeilenweise Ausblendung (Schreibrecht, Zustand). Fehlt = immer sichtbar. */
  sichtbar?: (zeile: T) => boolean;
}

/**
 * Titelzeile der Karte UND erste Spalte der Tabelle.
 *
 * `ziel` macht die Titelzelle in BEIDEN Zweigen zu einem echten `<Link>` — das ist das
 * Tastaturziel der Zeile.
 *
 * REGEL: trägt `ziel` einen Wert, darf das `render` der Titelspalte selbst KEINEN Anker
 * erzeugen — sonst verschachtelte Links. Wer heute im Spalten-`render` verlinkt, hebt den
 * Link hierher.
 */
export interface TitelBezug<T, K extends string> {
  spalte: K;
  ziel?: (zeile: T) => string;
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
       * Statusetikett. Vertragstyp, KEIN Farbstring — `label` ist Pflichtfeld und damit
       * der erzwungene zweite Kanal. `null` = kein Etikett.
       *
       * Ausdrücklich NICHT das `render` der Statusspalte: dort steht im Schreibmodus ein
       * Auswahlfeld mit fester Mindestbreite, das eine 390-px-Karte breit drückt.
       */
      status?: (zeile: T) => StatusDarstellung | null;
      /**
       * Macht das Statusetikett BEDIENBAR (LFH-339 · C4, Zielform-Spec §5). Deskriptor,
       * kein `ReactNode`-Slot — damit behält das Primitiv Form, Höhe und Trefffläche;
       * eine Klein-Variante oder eine Farbfläche sind von außen nicht einschmuggelbar.
       *
       * Der Bedienweg sitzt bewusst HIER und nicht am {@link PrimaerAktion}-Slot: dort ist
       * genau EINE Aktion zugesichert, und die ist auf allen drei Kräfteseiten mit
       * „Entfernen" belegt. Die Antwort ist nicht, den Slot zu verdoppeln, sondern ihn
       * nicht zu brauchen — bedient wird, wo der Status schon steht. Die
       * Ein-Aktion-Zusicherung bleibt damit unangetastet.
       *
       * Fehlt das Feld oder liefert es `null`, bleibt das Etikett reine Anzeige.
       */
      statusBedienung?: (zeile: T) => StatusBedienung | null;
      /** HÖCHSTENS DREI Sekundärfelder — der Tupeltyp erzwingt die Obergrenze. */
      sekundaer?: readonly [K?, K?, K?];
      aktion?: PrimaerAktion<T>;
    }
  | {
      art: 'eigen';
      /** Nur mit Eintrag in `datensicht.guard.test.ts` (`KARTEN_EIGENBAU`). */
      render: (ktx: KartenKontext<T>) => ReactNode;
    };

// ── Sortierung, Gruppierung, Baum, Zufluss ───────────────────────────────────────────
/** `null` = Reihenfolge wie geliefert (Serverordnung unangetastet). */
export type Sortierung<K extends string> = { spalte: K; richtung: 'auf' | 'ab' } | null;

/**
 * Gruppenachse. Beide Zweige verwenden dieselben Schlüssel und Zähler, aber NICHT
 * dieselbe Form:
 *  · Kartenzweig: echte Gruppenköpfe („verfügbar · 7") über verschachtelten Listen.
 *  · Tabellenzweig: die Gruppenachse wird zur FÜHRENDEN Sortierachse (Gruppen liegen
 *    zusammenhängend), die Zähler stehen als Streifen in der Werkzeugzeile. KEINE
 *    synthetischen Gruppenzeilen — Spaltenfixierung × zeilenübergreifende Zellverbünde
 *    sind in diesem Repo ungeprüft, und `KatalogTabelle` fixiert Spalte 0 unbedingt.
 */
export interface Gruppierung<T> {
  schluessel: (zeile: T) => string;
  etikett: (wert: string) => string;
  /** Feste Gruppenfolge; unbekannte Werte hängen in Antreffreihenfolge hinten an. */
  reihenfolge?: readonly string[];
}

/**
 * Feldname, unter dem `T` Kinder DESSELBEN Typs trägt — sonst `never`. `-?` allein genügt
 * nicht: `T[K]` trägt bei optionalen Feldern weiter `| undefined`, deshalb `NonNullable`.
 */
export type KinderFeld<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends readonly T[] ? K & string : never;
}[keyof T];

/** Rekursive Sicht. EIN Prop, damit Feldname und Aufklappzustand nicht getrennt setzbar sind. */
export interface BaumSicht<T> {
  kinder: KinderFeld<T>;
  /** KONTROLLIERT — der Druckpfad der Kräfteübersicht setzt hier alle Schlüssel. */
  aufgeklappt: readonly Key[];
  onAufgeklappt: (schluessel: Key[]) => void;
}

/**
 * Verhalten bei nachfließenden Daten (Prüflisten-Kriterium 12, WCAG 3.2.5, CLS ≤ 0,1).
 *
 * `'sammelbanner'` (Default): solange der Fokus INNERHALB der Sicht liegt, bleiben
 *   Zeilenmenge und Zeilenreihenfolge eingefroren; Zellinhalte aktualisieren weiter
 *   (ein Statuswechsel muss sofort sichtbar sein, nur die Zeile darf nicht wandern).
 *   Neue Zeilen erscheinen als Banner in der Werkzeugzeile („7 neue Einträge — anzeigen").
 * `'sofort'`: kein Einfrieren. Nur für Flächen ohne fokussierbare Zeileninhalte.
 */
export type Zufluss = 'sammelbanner' | 'sofort';

// ── Props ────────────────────────────────────────────────────────────────────────────
export interface DatensichtProps<T extends object, K extends string> {
  /**
   * Zugängliche Bezeichnung. Wird `aria-label` an einem `<section>` (nicht an einem `<div>`
   * — ein nacktes `div` mit `aria-label` hat keine Rolle, `getByRole('region')` greift dort
   * nicht), Präfix der DEV-Diagnosen und Beschriftung des Spaltenschalters.
   */
  bezeichnung: string;
  /**
   * DIE Inferenzquelle für `K`. Alle anderen K-Positionen sind über `NoInfer` von der
   * Inferenz ausgenommen — sonst weitete ein Tippfehler im Kartenplan `K` einfach um sein
   * eigenes Literal, und die ganze Literalbewahrung wäre wirkungslos (gemessen).
   */
  spalten: readonly DatensichtSpalte<T, K>[];
  daten: readonly T[];
  zeilenSchluessel: (keyof T & string) | ((zeile: T) => Key);
  karte: Kartenplan<T, NoInfer<K>>;
  /** Default `'auto'`. */
  form?: Darstellungsform;
  /** Auto-Umbruch zur Tabelle; Default md. Abweichungen brauchen Browserbelege (LFH-464). */
  tabelleAb?: AbBreitePunkt;
  ladend?: boolean;
  /** Tabelle: `locale.emptyText`; Karte: `Liste emptyText`. KEIN neuer Leerzustands-Knoten. */
  leerText?: ReactNode;

  // Zustand — Voreinstellung ODER kontrolliert, nie beides
  standardSortierung?: Sortierung<NoInfer<K>>;
  sortierung?: Sortierung<NoInfer<K>>;
  onSortierung?: (s: Sortierung<NoInfer<K>>) => void;
  /** Freitextsuche über alle Spalten mit `suchText`. Im Baummodus verboten. */
  suche?: { platzhalter: string };
  gruppen?: Gruppierung<T>;
  /** Baumsicht. Schließt `suche`, Spaltenfilter, `gruppen` und `aufklappzeile` aus. */
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
   * Zeilenklick als KOMFORT, nur im Tabellenzweig (`onRow`). Das Tastatur- und
   * Berührungsziel ist in beiden Zweigen `karte.titel.ziel` — nicht die ganze Fläche.
   * Ein klickbarer Karten-Container gehört B7 (LFH-335), zusammen mit `Liste.tsx`.
   */
  onZeileKlick?: (zeile: T) => void;
  /** Zusatzknöpfe links in der Werkzeugzeile (z. B. „Drucken"). */
  werkzeuge?: ReactNode;
  /**
   * Antd-Aufklappzeile. Allowlist statt durchgereichtem `expandable`: ein per Subtraktion
   * definierter Durchlass wächst mit jedem fremden Prop mit und verrottet still, wenn ein
   * ausgeschlossener Name verschwindet. Nur im Tabellenzweig; schließt `baum` aus.
   */
  aufklappzeile?: (zeile: T) => ReactNode;
}

// ── Konstanten ───────────────────────────────────────────────────────────────────────
/** Höchstzahl der Sekundärfelder. Am Tupeltyp erzwungen, hier nur benannt. */
export const MAX_SEKUNDAER = 3;
/** Ab dieser Tiefe wächst die Karteneinrückung nicht weiter (390 px). */
export const TIEFE_DECKEL = 3;

// ── Reine Funktionen: hier wohnt die Drift, deshalb exportiert ────────────────────────

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
 * Der Zellinhalt, den BEIDE Zweige benutzen.
 *
 * antds `render` darf eine Zellbeschreibung `{ props?, children? }` liefern
 * (`@rc-component/table`, `RenderedCell`). React-Elemente tragen ebenfalls `props`,
 * deshalb ZUERST `isValidElement` prüfen und erst danach auf `children` auspacken.
 * Zellverbund-Angaben sind in der Karte bedeutungslos.
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

/** `etikett ?? title` (nur wenn `title` ein String ist), sonst `undefined` + DEV-Warnung. */
export function etikettVon<T>(spalte: DatensichtSpalte<T>): string | undefined {
  if (spalte.etikett != null) return spalte.etikett;
  if (typeof spalte.title === 'string') return spalte.title;
  if (import.meta.env.DEV) {
    console.warn(
      `[Datensicht] Spalte "${spalte.key}" hat kein etikett und keinen String-title. ` +
        'Karte, Spaltenschalter und Sortierauswahl brauchen einen Klartext — `etikett` setzen.',
    );
  }
  return undefined;
}

/**
 * Sortiert Text so, wie eine Einsatzkraft ihn liest: „Florian 2" vor „Florian 10".
 *
 * Ohne `numeric` vergleicht `localeCompare` Ziffer für Ziffer und legt die 10 vor die 2 —
 * genau in der Spalte, die die Bedien-Leitlinie als menschenlesbare Kennung fixiert
 * (Funkrufname, Ordnungsnummer). Die Sprache steht FEST auf `de` statt auf der
 * Systemsprache: sonst hinge die Reihenfolge an der Umgebung, in der der Test läuft.
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
 * Die EINE Quelle der gerenderten Zeilen und der benannte Seam für B3 (LFH-331): dort
 * wechselt nur die Herkunft von `daten`, die Signatur bleibt.
 * Flach: filtern, suchen, gruppen-sortieren, sortieren. Baum: `daten` unverändert.
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

  // Die Gruppenachse ist die FÜHRENDE Achse: nur so liegen die Gruppen zusammenhängend,
  // und der Tabellenzweig (der keine synthetischen Gruppenzeilen bekommt) zeigt eine
  // Gruppierung, die man auch sieht.
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
  // Nur BELEGTE Gruppen: ein leerer Kopf „· 0" aus der festen Reihenfolge wäre Rauschen
  // und bliese die Zählerstreifen der Werkzeugzeile auf.
  return [...eimer.keys()]
    .sort((a, b) => rang.get(a)! - rang.get(b)!)
    .map((wert) => ({ wert, etikett: gruppen.etikett(wert), zeilen: eimer.get(wert)! }));
}

/** Klasse, die eine per Deeplink angesteuerte Zeile markiert (LFH-25). */
export const HERVORGEHOBEN = 'zeile-hervorgehoben';

/**
 * Scrollt die per Deeplink angesteuerte Zeile ins Bild — in BEIDEN Zweigen.
 *
 * Der Selektor `[data-row-key="…"]` allein trifft nur die Tabelle. Unter `md` rendert das
 * Primitiv Karten, dort gibt es kein `data-row-key`, und der Sprung lief still ins Leere:
 * genau auf dem Gerät, auf dem eine lange Liste am wenigsten überschaubar ist. Deshalb liegt
 * die Funktion hier und nicht in den Seiten — die Zweige und ihre Merkmale gehören dem
 * Primitiv, nicht seinen Aufrufern.
 *
 * `scrollIntoView` fehlt in jsdom; der optionale Aufruf hält das No-op fest.
 */
export function scrolleZurZeile(schluessel: Key): void {
  const ziel = document.querySelector(
    `[data-row-key="${schluessel}"], [data-lfh="datensicht-karte"].${HERVORGEHOBEN}`,
  );
  ziel?.scrollIntoView?.({ block: 'center' });
}

/** Sichtbare Spalten + Zähler — EINE Wahrheit aus Handauswahl UND `abBreite`. */
export function sichtbareSpalten<T, K extends string>(args: {
  spalten: readonly DatensichtSpalte<T, K>[];
  verborgen: ReadonlySet<K>;
  abBreite: (punkt: AbBreitePunkt) => boolean;
}): { spalten: readonly DatensichtSpalte<T, K>[]; anzahlVerborgen: number } {
  const { spalten, verborgen, abBreite } = args;
  const sichtbar: DatensichtSpalte<T, K>[] = [];
  let anzahlVerborgen = 0;
  spalten.forEach((spalte, index) => {
    /**
     * INDEX 0 IST NIE ENTFERNBAR. `KatalogTabelle` fixiert, was als Spalte 0 ANKOMMT,
     * nicht eine benannte. Fällt Spalte 0 weg, wird still eine ANDERE Spalte die fixierte
     * Kennung — kein Fehler, kein roter Test, nur eine falsche Fixierung. `immerSichtbar`
     * allein genügt dafür nicht: es ist ein Flag, das jemand vergisst.
     */
    if (index === 0 || spalte.immerSichtbar) {
      sichtbar.push(spalte);
      return;
    }
    // BEIDE Gründe in EINEM Zähler, und eine doppelt verborgene Spalte nur einmal —
    // ein Zähler, der „0 ausgeblendet" meldet, verfehlt das Kriterium, für das er da ist.
    if (verborgen.has(spalte.key) || (spalte.abBreite != null && !abBreite(spalte.abBreite))) {
      anzahlVerborgen += 1;
      return;
    }
    sichtbar.push(spalte);
  });
  return { spalten: sichtbar, anzahlVerborgen };
}

/**
 * Mängelliste des Kartenplans gegen das Spaltenregister; leeres Array = in Ordnung.
 * `Datensicht` ruft sie im DEV-Effekt und gibt sie an `console.warn` mit Präfix
 * `[Datensicht: <bezeichnung>]`; der Test ruft sie DIREKT — kein console-Spion, keine
 * Abgrenzung gegen antd-Fremdwarnungen.
 */
export function pruefeKartenplan<T extends object, K extends string>(
  props: Pick<
    DatensichtProps<T, K>,
    'spalten' | 'karte' | 'suche' | 'baum' | 'gruppen' | 'aufklappzeile' | 'onZeileKlick'
  >,
  bezeichnung: string,
): string[] {
  const { spalten, karte, suche, baum, gruppen, aufklappzeile, onZeileKlick } = props;
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
    if (aufklappzeile) befunde.push('aufklappzeile und baum schließen sich aus.');
    // Im Baummodus klappt die ganze Zeile auf (LFH-338 · C3). Ein zusätzliches
    // `onZeileKlick` wäre eine zweite Wirkung auf demselben Klick, und welche einträte,
    // hinge an der Reihenfolge im DOM.
    if (onZeileKlick) befunde.push('onZeileKlick und baum schließen sich aus.');
  }
  return befunde;
}

/** Die abwählbaren Spalten: alles außer der Kennungsspalte und den `immerSichtbar`-Spalten. */
function waehlbareSpalten<T, K extends string>(
  spalten: readonly DatensichtSpalte<T, K>[],
): readonly DatensichtSpalte<T, K>[] {
  return spalten.filter((s, i) => i !== 0 && !s.immerSichtbar);
}

/**
 * Gibt es überhaupt etwas zu schalten? EINE Wahrheit für zwei Leser (LFH-391 · B4).
 *
 * Der Schalter selbst rendert bei `false` gar nichts — und die Kommandopalette darf dann
 * auch keinen Befehl „Spalten" anbieten, der auf einen nicht vorhandenen Schalter zeigt.
 * Rechnete jede Seite das für sich, wäre das derselbe Fehlermodus wie beim Spaltenzähler:
 * eine Angabe, die lügen kann, verfehlt genau das Kriterium, für das sie existiert.
 */
export function hatWaehlbareSpalten<T, K extends string>(
  spalten: readonly DatensichtSpalte<T, K>[],
): boolean {
  return waehlbareSpalten(spalten).length > 0;
}

/** Der Schalter für Seiten, die ihn EINMAL über mehreren Sichten zeigen. */
export function SpaltenSchalter<T, K extends string>(props: {
  bezeichnung: string;
  spalten: readonly DatensichtSpalte<T, K>[];
  aus: readonly K[];
  onAus: (schluessel: K[]) => void;
  /**
   * Optionale KONTROLLIERTE Offen-Achse. Ohne beide Props bleibt das Dropdown unkontrolliert
   * wie bisher — der Export ist für Seiten gedacht, die den Schalter selbst platzieren, und
   * ein Pflicht-Prop wäre eine Vertragsänderung ohne Gegenstand (gemessen: kein externer
   * Aufrufer). Gebraucht wird sie, weil die Kommandopalette den Schalter von AUSSEN öffnet:
   * `trigger={['click']}` allein hat keinen Weg hinein.
   */
  offen?: boolean;
  onOffen?: (offen: boolean) => void;
}): ReactNode {
  const { bezeichnung, spalten, aus, onAus, offen, onOffen } = props;
  // Der Schalter stellt die Breitenfrage SELBST, statt den Zähler übergeben zu bekommen:
  // sonst gäbe es zwei Stellen, an denen „wie viele sind ausgeblendet" gerechnet wird, und
  // die Seiten-Variante (ein Schalter über mehreren Sichten) driftete von der internen weg.
  const { abBreite } = useViewport();
  const { anzahlVerborgen } = sichtbareSpalten({ spalten, verborgen: new Set(aus), abBreite });
  const waehlbar = waehlbareSpalten(spalten);
  // Bewusst über {@link hatWaehlbareSpalten} statt über `waehlbar.length` — es ist genau die
  // Funktion, die auch die Palette liest. Wer die Bedingung hier ändert, sieht die zweite
  // Seite im selben Aufruf.
  if (!hatWaehlbareSpalten(spalten)) return null;

  const umschalten = (schluessel: K) =>
    onAus(aus.includes(schluessel) ? aus.filter((k) => k !== schluessel) : [...aus, schluessel]);

  /**
   * Der Zähler steht als TEXT im Namen, nicht als Zähl-Abzeichen: ein antd-`Badge` mit
   * `count` und ohne `color` rendert auf `token.colorError` — Rot für einen Spaltenzähler
   * bricht „Rot bedient nichts" und Kriterium 7.
   *
   * Und er zählt BEIDE Ursachen (Handauswahl UND `abBreite`) aus {@link sichtbareSpalten},
   * nicht bloß `aus.length`: ein Zähler, der „1 ausgeblendet" meldet, während zwei Spalten
   * fehlen, verfehlt genau das Kriterium (14), für das er existiert.
   */
  const beschriftung =
    anzahlVerborgen === 0 ? 'Spalten' : `Spalten · ${anzahlVerborgen} ausgeblendet`;

  return (
    <Dropdown
      trigger={['click']}
      // `undefined` lässt rc-trigger in seinem unkontrollierten Zweig — die Achse ist
      // additiv, kein Bruch für Aufrufer ohne die Props.
      open={offen}
      onOpenChange={onOffen}
      /*
       * Der Fokus muss beim Öffnen IN das Menü wandern. Ohne `autoFocus` bleibt er am Knopf,
       * die Pfeiltasten heben keinen Eintrag hervor, und die Eingabetaste schließt das Menü
       * wieder — gemessen: nach `ArrowDown` stand `document.activeElement` weiter auf dem
       * Knopf und `.ant-dropdown-menu-item-active` bei 0.
       */
      autoFocus
      menu={{
        /*
         * Umgeschaltet wird am MENÜEINTRAG, nicht am Kontrollkästchen: rc-menu ruft `onClick`
         * auf beiden Wegen auf — Mausklick und Eingabe-/Leertaste auf dem hervorgehobenen
         * Eintrag. Hing der Umschalter allein am `onChange` des Kästchens, gab es nur einen
         * Mausweg; die Tastatur konnte den Schalter öffnen, aber keine Spalte umschalten
         * (WCAG 2.1.1). Der Nachweis liegt in `frontend/e2e/datensicht-schmal.spec.ts` und
         * nicht in Vitest: jsdom liefert kein Fokusverhalten für ein Portal-Menü.
         */
        onClick: ({ key }) => umschalten(key as K),
        items: waehlbar.map((spalte) => ({
          key: spalte.key,
          label: (
            /*
             * Das Kästchen ist ANZEIGE, kein zweiter Umschalter: mit eigenem `onChange` würde
             * ein Mausklick darauf zusätzlich das `onClick` des Eintrags auslösen und die
             * Umschaltung im selben Atemzug zurücknehmen.
             */
            <Checkbox checked={!aus.includes(spalte.key)}>
              {etikettVon(spalte) ?? spalte.key}
            </Checkbox>
          ),
        })),
      }}
    >
      {/* Kein `size`-Prop: die Höhe kommt aus `controlHeight` und zieht mit der Dichte mit. */}
      <Button aria-label={`${beschriftung} — ${bezeichnung}`}>{beschriftung}</Button>
    </Dropdown>
  );
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
    tabelleAb = 'md',
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
    aufklappzeile,
  } = props;

  const { token } = theme.useToken();
  const { abBreite } = useViewport();
  const wurzel = useRef<HTMLElement>(null);
  const werkzeugWurzel = useRef<HTMLDivElement>(null);

  /**
   * DIE ZEILENSCHLEUSE (Prüflisten-Kriterium 12) — Zustand zuerst, weil die Setter der
   * Sortierung, Suche, Filter und des Spaltenschalters unten auf
   * {@link nachBenutzeraktion} zugreifen.
   *
   * Im Zustand `gefroren` hält `folge` die Schlüsselreihenfolge, die beim Fokuseintritt
   * sichtbar war. Gerendert wird dann diese FOLGE, durch eine frische
   * Schlüssel→Zeile-Karte gezogen: die Position kommt aus der eingefrorenen Liste, der
   * Inhalt aus `daten`. Ein Statuswechsel bleibt damit sofort sichtbar, die Zeile wandert
   * aber nicht.
   *
   * Bewusst NICHT „filtere die frischen Zeilen auf die gefrorene Schlüsselmenge": die
   * Überlebenden bekämen dann die NEUE Reihenfolge, und genau das ist der Sprung unter dem
   * Cursor, den das Kriterium verbietet.
   *
   * `gruppeVon` friert die GRUPPENZUGEHÖRIGKEIT mit ein, nicht nur die Folge. Ohne sie
   * bestimmt {@link gruppiere} die Gruppe aus den frischen Daten: ein Statuswechsel per
   * Live-Ereignis hängt die Karte unter einen anderen Gruppenkopf um, während die Sicht
   * eingefroren ist — dieselbe Bewegung, die die Zusicherung oben („nur die Zeile darf nicht
   * wandern") verbietet, nur eine Achse weiter. Eine Zeile, deren Gruppenwert sich ändert,
   * bleibt deshalb bis zum Auftauen unter ihrem alten Kopf; der Zellinhalt zeigt den neuen
   * Status sofort.
   *
   * ── WARUM DREI ZUSTÄNDE UND NICHT `readonly Key[] | null` ────────────────────────
   *
   * Zwei Bewegungen sehen gleich aus und sind es nicht: eine Zeile, die von SELBST unter
   * dem Cursor wegrutscht, ist der verbotene Sprung — eine Neuordnung, die der Benutzer
   * SELBST angestoßen hat (Sortierklick, Suche, Filter, Bannerklick), ist die Antwort auf
   * seine Eingabe und muss sofort zu sehen sein.
   *
   * `null` allein kann beides nicht unterscheiden. `'neu'` ist deshalb ein eigener Zustand:
   * ein AUFTRAG, neu einzufrieren, den der Layout-Effekt unten mit der dann bereits
   * neugeordneten Zeilenfolge erfüllt. Das Einfrieren beim Fokuseintritt dagegen geschieht
   * SYNCHRON im Handler — dort ist die noch sichtbare Folge die richtige, und ein
   * nachgelagerter Effekt ließe genau einen Datenstand durchrutschen.
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
      // Eine Spaltenumschaltung IST eine Benutzeraktion — und zwar die einzige der
      // Werkzeugzeile, die das hier lange vergessen hat. Blendet man eine gefilterte
      // Spalte aus, wird ihr Filter unwirksam (siehe „Spaltensichtbarkeit" unten); die
      // dadurch freigegebenen Zeilen sind die ANTWORT auf den Klick, kein Zufluss. Ohne
      // diesen Aufruf zaehlt die gefrorene Schleuse sie als neu und schiebt sie hinter das
      // Sammelbanner: die Liste bleibt kurz, und daneben behauptet ein Banner „1 neuer
      // Eintrag" fuer eine Zeile, die nicht neu ist.
      // Greift nur fuer den eingebauten Schalter: nimmt eine Seite den exportierten
      // SpaltenSchalter mit kontrolliertem spaltenAus/onSpaltenAus, laeuft die Umschaltung
      // am Setter vorbei. Heute tut das keine (gemessen).
      nachBenutzeraktion();
    },
    [spaltenAus, onSpaltenAus, nachBenutzeraktion],
  );

  const [suchbegriff, setSuchbegriff] = useState('');
  const [filterWerte, setFilterWerte] = useState<Record<string, readonly string[]>>({});
  const filterZuruecksetzen = useCallback(() => {
    setSuchbegriff('');
    setFilterWerte({});
    nachBenutzeraktion();
  }, [nachBenutzeraktion]);

  // ── Formwahl ──────────────────────────────────────────────────────────────────────
  // Steht HIER und nicht erst bei der Werkzeugzeile, weil die Ebenen-Registrierung
  // gleich darunter sie liest: der Spaltenschalter existiert nur im Tabellenzweig.
  const alsTabelle = form === 'tabelle' || (form === 'auto' && abBreite(tabelleAb));

  const [spaltenOffen, setSpaltenOffen] = useState(false);

  // Steht der Schalter überhaupt? EINE Wahrheit für drei Leser: die Palettenmeldung unten,
  // der Rücksetzer daneben und der Schalter selbst (Kartenzweig → gar nicht gerendert;
  // ohne wählbare Spalte → `null`).
  const spaltenSchalterDa = alsTabelle && hatWaehlbareSpalten(spalten);

  /*
   * Verschwindet der Schalter, feuert antd KEIN `onOpenChange(false)` — der Zustand bliebe
   * auf `true` stehen und das Overlay klappte beim Wiederauftauchen unaufgefordert über den
   * Inhalt (gemessen: `form='auto'`, Fenster unter `md` und zurück). Vor der kontrollierten
   * Offen-Achse aus LFH-391 · B4 starb der Zustand mit der Komponente; die Achse hat ihn
   * überlebensfähig gemacht, also muss sie ihn auch beenden. Der Riegel hängt an BEIDEN
   * Bedingungen, nicht nur an der Breite: ein Wechsel der Spaltengarnitur nimmt den Schalter
   * genauso weg.
   */
  useEffect(() => {
    if (!spaltenSchalterDa) setSpaltenOffen(false);
  }, [spaltenSchalterDa]);

  useTastaturEbene({
    name: `Datensicht-Filter: ${bezeichnung}`,
    wurzel: werkzeugWurzel,
    aktionen: {
      // Nur melden, was die Zeile auch hält (LFH-391 · B4) — ein Befehl auf einen nicht
      // vorhandenen Schalter wäre ein Befehl ohne Wirkung.
      'filter-zuruecksetzen': filterZuruecksetzen,
      ...(spaltenSchalterDa ? { spalten: () => setSpaltenOffen(true) } : {}),
    },
  });

  // ── Spaltensichtbarkeit ───────────────────────────────────────────────────────────
  // Steht VOR der Zeilenmenge, weil die wirksamen Filter davon abhängen (siehe unten).
  const verborgen = useMemo(() => new Set(aktiveSpaltenAus), [aktiveSpaltenAus]);
  const { spalten: gezeigteSpalten } = useMemo(
    () => sichtbareSpalten({ spalten, verborgen, abBreite }),
    [spalten, verborgen, abBreite],
  );

  /**
   * WAS MAN NICHT SIEHT, WIRKT NICHT: nur Filter sichtbarer Spalten schneiden die Zeilenmenge.
   *
   * Vorher hing das Bedienelement an {@link gezeigteSpalten}, die Wirkung aber an allen
   * Spalten — wer eine Spalte mit gesetztem Filter ausblendete, behielt eine gefilterte
   * Liste ohne sichtbaren Grund und ohne Rückweg (das Bedienelement war ja weg).
   *
   * Der Wert bleibt im Zustand stehen und wirkt beim Wiedereinblenden erneut; verworfen wird
   * er nicht. GEWÄHLTE FOLGE, kein Nebeneffekt: das gilt auch für Spalten, die `abBreite`
   * verbirgt — beim Verkleinern des Fensters ändert sich also die Zeilenzahl. Das ist die
   * Kehrseite derselben Regel und bewusst so: ein unsichtbar wirkender Filter ist der
   * schlechtere Zustand. Der Spaltenzähler behandelt beide Ursachen ebenfalls gleich
   * (`sichtbareSpalten` zählt Handauswahl UND `abBreite`) — Zähler und Filter folgen damit
   * derselben einen Wahrheit, nur an verschiedenen Enden.
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

  const { sichtbareZeilen, zufluessig } = useMemo(() => {
    if (!gefroren) return { sichtbareZeilen: zeilen, zufluessig: 0 };
    const nachSchluessel = new Map(zeilen.map((z) => [schluessel(z), z]));
    const gefrorenMenge = new Set(gefroren);
    return {
      // Entfallene Schlüssel fallen sofort weg — eine nicht mehr vorhandene Zeile kann man
      // nicht rendern. Die Schleuse hält nur Zuwachs zurück.
      sichtbareZeilen: gefroren
        .map((k) => nachSchluessel.get(k))
        .filter((z): z is T => z !== undefined),
      zufluessig: zeilen.filter((z) => !gefrorenMenge.has(schluessel(z))).length,
    };
  }, [gefroren, zeilen, schluessel]);

  /**
   * Erfüllt den `'neu'`-Auftrag. `useLayoutEffect`, nicht `useEffect` — und das ist keine
   * Testkosmetik: ein nachgelagerter Effekt ließe genau EINEN Bildaufbau zwischen
   * „Benutzeraktion" und „Folge ist wieder gefroren". Trifft in dieser Lücke ein Datenstand
   * ein, rutscht er durch und die Zeile springt doch.
   */
  /**
   * Der eingefrorene Stand — Folge UND Gruppenzugehörigkeit. Beide Einfrierstellen (der
   * `'neu'`-Auftrag unten und {@link betreten}) gehen hierdurch: sie einzeln zu bauen hieße,
   * eine von beiden zu vergessen, und dann bliebe der Bannerweg kaputt, während der
   * Fokusweg richtig einfriert.
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
   * DIE LEERE LADEANSICHT FRIERT NICHT EIN.
   *
   * Die Werkzeugzeile steht IMMER im Baum, auch ohne Daten (Begründung unten am
   * `werkzeugzeile`-Knoten). Wer den Fokus vor der ersten Antwort ins Suchfeld setzt, fröre
   * damit eine LEERE Folge ein — und die gesamte erste Lieferung landete hinter dem
   * Sammelbanner statt in der Liste. Bei null gerenderten Zeilen gibt es nichts
   * einzufrieren: es steht kein Cursor über einer Zeile, also kann auch nichts unter ihm
   * wegrutschen.
   *
   * NICHT auf `ladend` gaten: ein Query, der auf `[]` auflöst und seine Zeilen erst per
   * SSE nachbekommt, hat `ladend === false` bei leerer Menge — derselbe Fehler, nur eine
   * Runde später. `zeilen` ist die einzige ehrliche Quelle.
   *
   * Der `'neu'`-Pfad braucht die Bedingung NICHT: {@link nachBenutzeraktion} ist aus dem
   * Zustand `'offen'` heraus ein No-op, und in einer nie eingefrorenen Sicht ist die
   * Schleuse genau das — es gibt also gar keinen Auftrag, den der Layout-Effekt erfüllen
   * könnte.
   *
   * BENANNTER REST, bewusst so: bleibt der Fokus nach dem Eintreffen in der Werkzeugzeile
   * stehen, ist die Schleuse weiter offen und späterer Zufluss schiebt sich live ein. Sie
   * schärft sich beim NÄCHSTEN Fokuseintritt nach — React delegiert `onFocus` über
   * `focusin`, das bubbelt, also genügt schon der Sprung Suchfeld → Zeilenlink (gemessen im
   * Test „… und schärft sich beim nächsten Fokuseintritt nach"); die Sicht ganz zu
   * verlassen ist nicht nötig. Nachzurüsten wäre nur ein Einfrieren beim ersten Datenstand,
   * das der Benutzer nicht ausgelöst hat — und es fröre ausgerechnet die Lieferung ein, auf
   * die er wartet.
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
   * `focusout` feuert AUCH beim Sprung von der Titelzelle zum Aktionsknopf derselben
   * Sicht. Ein Zuhörer ohne `contains`-Prüfung taute dort auf und schöbe die Zeilen unter
   * dem Finger weg — genau in der Sekunde, in der jemand bedient.
   */
  const pruefeVerlassen = useCallback((ziel: EventTarget | null) => {
    if (ziel != null && wurzel.current?.contains(ziel as Node)) return;
    /**
     * EIN ÜBERLAGERNDES MENÜ IST KEIN VERLASSEN (LFH-339 · C4).
     *
     * Seit der Statuswechsel am Etikett hängt, öffnet eine Bedienung in der Zeile ein
     * `Dropdown` — und dessen Inhalt liegt in einem PORTAL an `document.body`, also
     * ausserhalb von {@link wurzel}. antds `autoFocus` schiebt den Fokus beim Öffnen
     * dorthin; ohne diesen Zweig taute die Schleuse damit ausgerechnet in dem Moment auf,
     * für den sie gebaut ist: jemand hält das Menü offen, und die Zeile darunter wandert
     * weg.
     *
     * GEMESSEN UND DESHALB HIER NOTIERT: in jsdom passiert das NICHT — `autoFocus` lässt
     * den Fokus dort auf dem Auslöser stehen (nachgemessen am 17.08.2026, der aktive
     * Knoten war der `ant-dropdown-trigger` selbst, `inSicht: true`). Ein Test, der bloss
     * ein Menü öffnet und die Reihenfolge prüft, ist deshalb GRÜN, ohne diesen Zweig zu
     * berühren — er belegt nichts. Prüfbar ist nur der Handler selbst, mit einem
     * `relatedTarget` im Portal; genau so steht es im Test.
     *
     * Absichtlich über die Overlay-Klasse und nicht über eine Portal-Referenz: die
     * Overlays hängen an `document.body` und gehören keinem Knoten dieser Sicht, es gibt
     * also nichts, worauf eine Referenz zeigen könnte. Der Preis ist eine Kopplung an
     * antds Klassennamen — sichtbar hier statt versteckt in einer Hilfsfunktion.
     */
    if (ziel instanceof Node && (ziel as Element).closest?.('.ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown')) {
      return;
    }
    setSchleuse({ art: 'offen' });
  }, []);

  // ── DEV-Diagnose ──────────────────────────────────────────────────────────────────
  /**
   * `useMemo` über die Eingaben, Effekt über einen PRIMITIVEN Schlüssel. Ein Effekt mit
   * den Objekten selbst in den Deps feuerte bei jedem Render (alle Aufrufstellen bauen
   * Kartenplan und Spaltenliste je Render neu) und flutete die Konsole — und
   * `exhaustive-deps` ließe sich dann nur mit einem verbotenen Disable beruhigen.
   */
  const befunde = useMemo(
    () =>
      pruefeKartenplan(
        { spalten, karte, suche, baum, gruppen, aufklappzeile, onZeileKlick },
        bezeichnung,
      ),
    [spalten, karte, suche, baum, gruppen, aufklappzeile, onZeileKlick, bezeichnung],
  );
  const befundSchluessel = befunde.join(' | ');
  useEffect(() => {
    if (!import.meta.env.DEV || befundSchluessel === '') return;
    console.warn(`[Datensicht: ${bezeichnung}] ${befundSchluessel}`);
  }, [befundSchluessel, bezeichnung]);

  // ── Werkzeugzeile ─────────────────────────────────────────────────────────────────
  // (`alsTabelle` steht weiter oben — die Ebenen-Registrierung liest es mit.)
  const filterSpalten = gezeigteSpalten.filter((s) => s.filter != null);
  /**
   * Gruppiert wird über die EINGEFRORENE Achse, solange die Schleuse zu ist — sonst hängt ein
   * Statuswechsel die Karte im Kartenzweig unter einen anderen Gruppenkopf um (der Sprung,
   * den Kriterium 12 verbietet). Der Rückfall auf die frische Achse greift nur für Zeilen,
   * die beim Einfrieren nicht dabei waren; eine Zeile, deren Gruppenwert sich GEÄNDERT hat,
   * behält ihren alten Eimer, auch wenn der neue Wert in `reihenfolge` gar nicht vorkommt.
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
   * ZWEI Gruppierungen, und die Trennung ist der Punkt:
   *
   *  - `gruppenKarten` (gefrorene Achse) ordnet im KARTENZWEIG die Karten den Köpfen zu. Dort
   *    ist die Gruppe eine POSITION — eine umgehängte Karte ist der verbotene Sprung.
   *  - `gruppenZaehler` (frische Achse) speist den Zählerstreifen der Werkzeugzeile im
   *    Tabellenzweig. Dort ist die Gruppe eine ZAHL, keine Position: die Zeilenfolge steht
   *    ohnehin fest, und ein eingefrorener Zähler wäre dasselbe wie ein eingefrorener
   *    Zellinhalt — den schließt die Zusicherung oben ausdrücklich aus („ein Statuswechsel
   *    muss sofort sichtbar sein").
   */
  const gruppenZaehler = gruppen ? gruppiere(sichtbareZeilen, gruppen) : [];
  const gruppenKarten = gruppenAchse ? gruppiere(sichtbareZeilen, gruppenAchse) : [];

  const werkzeugzeile = (
    /**
     * IMMER gerendert, auch leer. Eine Zeile, die erst beim Eintreffen neuer Daten
     * erscheint, verschiebt Inhalt und arbeitet gegen ihr eigenes Ziel — die
     * Sticky-Reserve-Lehre aus B1. Und sie liegt AUSSERHALB des Tabellenrahmens, weil
     * `katalogtabelle-schmal.spec.ts` die Bildlaufbreite an dessen Wurzelknoten misst.
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
        // Bewusst ein nacktes `<input type="search">` statt `Input.Search`: der
        // Tabellenzweig läuft durch `KatalogTabelle`, dessen `suche` hier NICHT gesetzt
        // wird — zwei Felder nebeneinander wären die Folge. Höhe aus `controlHeight`,
        // kein `size`-Prop, fluide Breite ohne feste Zahl.
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
        // Sammelbanner statt eingeschobener Zeilen (WCAG 3.2.5, CLS ≤ 0,1). Kein
        // `danger`: Rot ist Gefahr, nicht Bedienung.
        <Button type="primary" onClick={nachBenutzeraktion}>
          {zufluessig === 1 ? '1 neuer Eintrag' : `${zufluessig} neue Einträge`} — anzeigen
        </Button>
      )}
    </div>
  );

  // ── Tabellenzweig ─────────────────────────────────────────────────────────────────
  /**
   * Zwei Stellen, an denen die Spaltenliste vor der Übergabe verändert wird, beide dem
   * Primitiv gehörend: die `abBreite`-Auflösung (oben, streicht die Spalte) und hier die
   * Injektion von `sorter: true` samt kontrollierter Richtung. `sorter: true` heißt für
   * antd „extern sortiert" — es zeichnet nur den Pfeil, sortiert wird in `effektiveDaten`.
   */
  /**
   * `mindestBreite` wird ABSICHTLICH NICHT herausgelöst, anders als `suchText` daneben: es
   * ist die Fließmarke, die `KatalogTabelle` für seine Breitenrechnung braucht (LFH-523),
   * und die Zieltypisierung als {@link KatalogSpalte} macht dieses Durchreichen sichtbar
   * statt zum Nebeneffekt des Spreads. Als `TableColumnsType` getippt fiele das Feld aus
   * dem Typ und der nächste Umbau hier nähme es stillschweigend mit.
   */
  const antdSpalten = useMemo<KatalogSpalte<T>[]>(
    () =>
      gezeigteSpalten.map((spalte) => {
        const { etikett, sortWert, suchText, filter, abBreite: _ab, immerSichtbar, ...antd } =
          spalte;
        void etikett;
        void suchText;
        void filter;
        void _ab;
        void immerSichtbar;
        const gebaut: KatalogSpalte<T> = { ...antd };

        /**
         * Der Titel-Link steht in BEIDEN Zweigen, nicht nur in der Karte: er ist das
         * Tastatur- und Berührungsziel der Zeile. Ein `onRow`-Klick allein wäre
         * maus-/tippgebunden und für die Trefflächenmessung unsichtbar.
         *
         * Deshalb die REGEL am Kartenplan: trägt `titel.ziel` einen Wert, darf das `render`
         * dieser Spalte selbst KEINEN Anker erzeugen — sonst verschachtelte Links. Wer im
         * Spalten-`render` verlinkt, hebt den Link hierher.
         */
        if (karte.art === 'plan' && karte.titel.ziel && spalte.key === karte.titel.spalte) {
          const ziel = karte.titel.ziel;
          gebaut.render = (_wert, zeile, index) => (
            <Link
              to={ziel(zeile)}
              style={{ display: 'inline-flex', alignItems: 'center', minHeight: token.controlHeight }}
            >
              {zelle(spalte, zeile, index)}
            </Link>
          );
        }

        if (!sortWert) return gebaut;
        // `sorter: true` heißt für antd „extern sortiert" — es zeichnet nur den Pfeil,
        // sortiert wird in `effektiveDaten`.
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

  const tabelle = (
    <KatalogTabelle<T>
      columns={antdSpalten}
      dataSource={[...sichtbareZeilen]}
      rowKey={(zeile) => schluessel(zeile)}
      loading={ladend}
      locale={leerText != null ? { emptyText: leerText } : undefined}
      // Kein Suchfeld und keine Blätterung von `KatalogTabelle`: die Suche steht in der
      // Werkzeugzeile oben, und eine Seitenblätterung schnitte die Zeilenschleuse entzwei.
      pagination={false}
      rowClassName={zeilenKlasse ? (zeile) => zeilenKlasse(zeile) ?? '' : undefined}
      /**
       * DER ANKER BEDIENT DEN KLICK ALLEIN (LFH-340 · C5, gemessen an der Schadensliste).
       *
       * Eine Zeile trägt regelmäßig echte `<a>`: den Titel-Link, den das Primitiv aus
       * `karte.titel.ziel` selbst setzt, und Deeplinks aus einem Spalten-`render` (die
       * Geschädigt-Spalte der Schäden zeigt auf Personen- und Personal-Seiten). Ohne
       * diesen Riegel feuern bei EINEM Klick beide Wege: der Link navigiert auf sein
       * Ziel, und `onZeileKlick` schickt dieselbe Zeile auf ihre Detailseite. Bei
       * gleichem Ziel bleibt das unbemerkt, bei verschiedenem gewinnt der zweite.
       *
       * Am sichtbarsten wird es beim MODIFIER-Klick: Cmd/Strg+Klick öffnet den neuen Tab
       * (der Browser bedient das, `defaultPrevented` bleibt false) — und die aktuelle
       * Seite navigiert trotzdem weg. Genau das hat der Bestandstest der Schadensliste
       * gemessen, als sie noch eine handgebaute Tabelle mit `stopPropagation` am Link war.
       *
       * Der Riegel sitzt hier statt an jedem Link: ein `stopPropagation` je Anker müsste
       * jede Konsumentendatei mitbringen, und die Regel „trägt `titel.ziel` einen Wert,
       * darf das `render` keinen Anker erzeugen" verbietet dem Konsumenten gerade, den
       * Titel-Link selbst zu bauen — er kann dort also gar nichts stoppen.
       */
      onRow={
        onZeileKlick
          ? (zeile) => ({
              onClick: (event) => {
                if ((event.target as HTMLElement).closest('a')) return;
                onZeileKlick(zeile);
              },
            })
          : undefined
      }
      /**
       * In dieser Sicht ist Sortieren der EINZIGE Auslöser: die Tabelle bekommt von hier
       * weder Blätterung noch Spaltenfilter. Deshalb darf `onChange` die Sortierung auch
       * LÖSCHEN, ohne einen fremden Anlass zu treffen.
       *
       * Und das muss es: antds Zyklus ist aufsteigend → absteigend → gar nicht, und im
       * dritten Schritt kommt `columnKey` als `undefined` zurück. Ein `if (columnKey == null)
       * return` schluckt genau diesen Schritt — die Tabelle bliebe dann für immer absteigend,
       * ohne Fehler und ohne roten Test (gemessen).
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
              // Die ganze Zeile ist das Trefferziel, nicht das ~16 px breite Symbol
              // (LFH-338 · C3, Befund H7). Die Dichte-Staffel kann daran nichts ändern —
              // antd zeichnet das Symbol in fester Größe. Deshalb hier und nicht per
              // seitenlokalem `onRow`: die Regel gilt für jeden Baum, nicht nur für den
              // einen, der ihn heute nutzt. `onZeileKlick` ist im Baummodus dafür gesperrt
              // (siehe `pruefeKartenplan`).
              expandRowByClick: true,
            }
          : aufklappzeile
            ? { expandedRowRender: (zeile) => aufklappzeile(zeile) }
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
      // Kein `size`-Prop und kein `danger`: die Höhe kommt aus `controlHeight`, und Rot
      // bedient nichts. Die Rückfrage ist der zweite Handgriff aus Kriterium 4.
      aktion!.bestaetigung != null ? (
        <Popconfirm
          key="aktion"
          title={aktion!.bestaetigung}
          onConfirm={() => aktion!.onKlick(zeile)}
        >
          <Button>{aktion!.etikett}</Button>
        </Popconfirm>
      ) : (
        <Button key="aktion" onClick={() => aktion!.onKlick(zeile)}>
          {aktion!.etikett}
        </Button>
      )
    ) : null;

    return (
      <div
        data-lfh="datensicht-karte"
        className={zeilenKlasse?.(zeile)}
        style={{ paddingInlineStart: token.padding * Math.min(tiefe, TIEFE_DECKEL) }}
      >
        <ListenEintrag actions={knopf ? [knopf] : undefined}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS, flexWrap: 'wrap' }}>
              {ziel != null ? (
                // Das Tastaturziel der Zeile: ein echter Link mit Höhe aus `controlHeight`.
                // `ListenEintrag` ist ein nacktes `<div onClick>` und für die
                // Trefflächenmessung unsichtbar.
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
              {/* Das Statusetikett ist der Auslöser, wenn es einen Bedienweg gibt — und
                  sonst reine Anzeige. Ein `Select` passte hier nicht: seine feste
                  Mindestbreite drückte die 390-px-Karte breit, das Menü liegt dagegen im
                  Portal (LFH-339 · C4). */}
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
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                      {etikettVon(spalte) ?? spalte.key}
                    </Typography.Text>
                    <span>{zelle(spalte, zeile, index)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </ListenEintrag>
      </div>
    );
  };

  /**
   * Rekursion für den Kartenzweig mit gesetztem `baum`. Am Tag 1 nutzt sie niemand
   * (`form="tabelle"` am Meldebild) — sie ist der Weg, auf dem eine spätere, NICHT
   * vergleichende Baumfläche Karten bekommt, ohne eine zweite Rekursion zu bauen.
   * Die Einrückung wächst bis {@link TIEFE_DECKEL} und dann nicht weiter (390 px).
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
              {offen ? `${kinder.length} Untereinträge verbergen` : `${kinder.length} Untereinträge`}
            </Button>
          </div>
        )}
        {offen && kinder.map((kind, i) => baumEintrag(kind, i, tiefe + 1))}
      </div>
    );
  };

  const kartenListe = (zeilenMenge: readonly T[], kopf?: ReactNode) => (
    <Liste
      dataSource={zeilenMenge}
      rowKey={(zeile) => schluessel(zeile)}
      header={kopf}
      loading={ladend}
      // `emptyText` statt eines eigenen Leerzustands-Knotens — es entsteht kein zweiter.
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
            {kartenListe(
              g.zeilen,
              <Typography.Text strong>
                {g.etikett} · {g.zeilen.length}
              </Typography.Text>,
            )}
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
      {/* GENAU EIN Zweig im Baum — kein Umschalten per verborgener Fläche. Ein zweiter,
          verborgener Zweig machte jedes „unter md keine Tabelle"-Gate bedeutungslos. */}
      {alsTabelle ? tabelle : kartenZweig}
    </section>
  );
}
