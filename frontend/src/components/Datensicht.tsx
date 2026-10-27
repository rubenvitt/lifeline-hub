import { IconChevronRechts, IconChevronRunter } from '../icons';
import { Button, ConfigProvider, Popconfirm, Typography, theme } from 'antd';
import type { CSSProperties, HTMLAttributes, Key, ReactNode, TableHTMLAttributes } from 'react';
import type { TableColumnType } from 'antd';
import {
  createContext,
  Fragment,
  isValidElement,
  memo,
  useCallback,
  useContext,
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
import Filterhinweis from './instrument/Filterhinweis';
import { monoStil, rollenwerte } from './instrument/rollenwerte';
import { zielEinzug } from './instrument/zielEinzug';
import { useViewport, type AbBreitePunkt } from './useViewport';
import { MenueAusloeser, type MenueEintrag } from './MenueAusloeser';
import { ZeilenFehler } from './SpeicherHinweis';
import type { ZeilenGrund } from './useZeilenFehler';
import {
  etikettVon,
  hatWaehlbareSpalten,
  sichtbareSpalten,
  SpaltenSchalter,
  type SpaltenSchalterZustand,
} from './SpaltenSchalter';

// Zählung und Schalter wohnen in `SpaltenSchalter.tsx` (zweiter Träger: `KatalogTabelle`). Der
// Weiterexport hält Bestandsimporte stabil; neue Aufrufer importieren direkt von dort.
export { etikettVon, hatWaehlbareSpalten, sichtbareSpalten };
import type { StatusDarstellung } from '../theme/statusFarben';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';
import { kennungsLinkStil } from './kennungsLink';
import { useDruckModus } from './druck/useDruckModus';
import {
  bannerText,
  flachZufluss,
  useZuflussSchleuse,
  useZuflussSteuerung,
} from './useZuflussSchleuse';
import { FENSTER_EINTRAG, FENSTER_ENDE, useFensterAusschnitt } from './fensterAusschnitt';
import { schleuse as baumSchleuse, type Wartend } from './organigramm/baumSchleuse';
import { aktiveFilter, FilterChips, filterMerkmale, kopfGefiltertStil } from './tabellenFilter';
import { GEDAECHTNIS_ENTPRELLUNG_MS, type ListenGedaechtnis } from './listenGedaechtnis';

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
 * ── SECHS ZUSICHERUNGEN ──
 *
 * 1. **Genau EIN Zweig im Baum**, kein Umschalten per verborgener Fläche: ein verborgener Zweig
 *    machte jedes „unter md keine Tabelle“-Gate bedeutungslos und montierte Steuerelemente
 *    doppelt.
 * 2. **EINE Reihenfolge, EINE Menge für beide Zweige.** antds Sortier- und Filterhaken sind am
 *    Spaltentyp abgeschnitten, weil `Table` deren Zustand intern hält; sortiert und gefiltert
 *    wird hier. Die Tabelle bekommt Pfeil und Kopfmenü KONTROLLIERT (`sortOrder`,
 *    `filteredValue`, kein `onFilter`, LLH-1086): sie zeichnet nur, die Menge entsteht in
 *    `effektiveDaten` bzw. am Server. Der Kartenzweig hat keinen Kopf und trägt Sortierauswahl
 *    und Auswahlfelder in der Werkzeugzeile, über demselben Zustand.
 * 3. **EINE Sichtbarkeitswahrheit.** `abBreite` ersetzt antds Breiten-Prop, das Verbergen-Flag
 *    ist gestrichen, beide Ausblendungsgründe fließen in DENSELBEN Zähler (Kriterium 14).
 * 4. **Das Tastaturziel der Zeile ist die Titelzelle.** Bei gesetztem `titel.ziel` rendert sie
 *    in BEIDEN Zweigen einen echten `<Link>` mit Höhe aus `controlHeight`; `ListenEintrag` legt
 *    `onClick` auf ein nacktes `<div>` ohne Rolle und Tastaturbedienung.
 * 5. **Zeilen springen nicht unter dem Cursor.** Solange der Fokus in der Sicht liegt oder ein
 *    Maus- bzw. Stiftzeiger über ihr (LFH-1020), sind Zeilenmenge und -reihenfolge eingefroren,
 *    im Baum auf jeder Ebene; Zellinhalte laufen weiter; Zufluss erscheint als Banner (WCAG 3.2.5,
 *    CLS ≤ 0,1). Die Werkzeugzeile steht IMMER, auch leer.
 * 6. **Eine Einschränkung ist sichtbar und gemerkt** (LLH-1086, Spec `tabellen-sortieren-filtern`).
 *    Wirkt eine Suche oder ein Filter, steht der `Filterhinweis` (Treffer von Gesamt, im Servermodus
 *    nur aus der Serverzählung) und je Wert ein Chip; „Filter zurücksetzen“ leert Suche und Filter,
 *    nicht die Sortierung. Was man nicht sieht, wirkt nicht: der Filter einer ausgeblendeten Spalte
 *    bleibt im Zustand, schneidet nichts und steht deshalb auch nicht als Chip da. Ausnahme
 *    `filter.feldOhneSpalte` (LLH-1276): weicht die Spalte nur der Breite, steht ihr Filter als
 *    Feld in der Werkzeugzeile, man sieht ihn also, und er wirkt. Mit `gedaechtnis`
 *    beginnen Sortierung, Filter, Suche und Spaltenwahl beim gemerkten Stand und gehen entprellt
 *    zurück (`components/listenGedaechtnis.ts`); Hinweis und Chips erscheinen nur bei
 *    Einschränkung, als Antwort auf die eigene Wahl.
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
 *   stromaufwärts über die Vollmenge kumuliert (`kraefte/kraeftebaumKern.ts`) und lögen still, fiele
 *   hier eine Zeile weg. Vorgefiltert wird stromaufwärts (`filtereKraefte`).
 */

/** Einzug je Baumebene in px: antds Vorgabe (`indentSize`), seit LFH-977 selbst gezeichnet. */
const BAUM_EINZUG_PX = 15;
/**
 * Einzug je Baumebene unter md (LLH-1029, vormals die Einheiten-Gliederung, LFH-975): am Handy
 * fräße der volle Einzug auf drei Ebenen ein Viertel der ersten Spalte. Das Aufklappsymbol behält
 * seine Breite, es ist ein Bedienziel.
 */
const BAUM_EINZUG_SCHMAL_PX = 8;

/**
 * Trefffläche des Aufklappsymbols im Baum (LLH-1240): antds Symbol misst fest ~17 px, in jeder
 * Stufe. Der Knopf trägt deshalb den Boden der Staffel (Höhe `controlHeight`, Breite
 * `controlHeightSM` wie `antdKnopf()`), das Symbol steht unverändert mittig darin.
 *
 * Der Text einer Zeile MIT Knopf steht in einem Block derselben Mindesthöhe, mittig
 * (`baumTextStil`): ein Link mit Steuerhöhe füllt ihn, ein nackter Text („Ohne Einheit“) rückt in
 * seine Mitte, und das Symbol steht in beiden Fällen neben der ersten Textzeile. Eine Ausrichtung
 * an der Grundlinie trüge nicht: die Zelle eines Moduls (Zeichen vor dem Namen) legt sie an den
 * Fuß ihres ersten Kinds. Im Druck fallen die Böden (`druck/druck.css`). Rein und exportiert,
 * aufgelöste Tokens.
 */
export function baumSymbolZielStil(token: {
  controlHeight: number;
  controlHeightSM: number;
}): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    minWidth: token.controlHeightSM,
    minHeight: token.controlHeight,
    padding: 0,
    border: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  };
}

/**
 * Reihe der Kartenfelder — rein und exportiert, damit die Fuge je Stufe ohne Layout prüfbar ist.
 * Der gefüllte Wert einer `InlineAngabe` rückt am Anfang um `paddingSM` in die Fuge vor
 * (`wertAngabeStil`), die leere Aufforderung nicht. Quer steht die Fuge deshalb um genau diesen
 * Vorsprung weiter: sonst lag ein Wert hinter einer Aufforderung nur `padding − paddingSM`
 * (7 / 10 px) vor ihr, Kriterium 2 verlangt komfortabel ≥ 8, handschuh ≥ 16 (LLH-1271). Gemessen
 * in `e2e/inline-angabe-dichte.spec.ts`.
 */
export function kartenFelderStil(token: { padding: number; paddingSM: number }): CSSProperties {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    rowGap: token.padding,
    columnGap: token.padding + token.paddingSM,
  };
}

/** Textblock einer Baumzeile; mit Knopf hält er dessen Höhe und mittet den Inhalt. */
export function baumTextStil(token: { controlHeight: number }, mitKnopf: boolean): CSSProperties {
  return mitKnopf
    ? {
        minWidth: 0,
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: token.controlHeight,
      }
    : { minWidth: 0, flex: '1 1 auto' };
}

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
    /**
     * Kein Auswahlfeld im Kartenzweig (LLH-1096): wo jedes weitere Feld die erste Karte am Handy aus
     * dem ersten Bild schöbe (Betroffene, `e2e/betroffene-handy.spec.ts`) und die Seite die Achse
     * schon über der Liste führt (Statusleiste, Sichtungsraster). Ein wirkender Wert (aus Adresse
     * oder Tabelle) schneidet weiter und steht als Chip da; die Menge bleibt dieselbe.
     */
    ohneKartenfeld?: boolean;
    /**
     * Feld ohne Spalte (LLH-1276): weicht die Spalte in der TABELLE der Breite (`abBreite`), steht
     * der Filter als Auswahlfeld in der Werkzeugzeile, wirkt und steht als Chip da. Ohne die
     * Kennzeichnung ginge er mit der Spalte verloren (Materialliste: Kategorie am Fükw). Von Hand
     * ausgeblendet gilt die Regel ohne Ausnahme; im Kartenzweig wirkungslos.
     */
    feldOhneSpalte?: boolean;
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
   * Nur mit `bestaetigung`: Bestätigungsknopf der Rückfrage, mit Verb und Objekt („Aus Einsatz
   * entfernen“). Fehlt ⇒ `etikett`, nie antds „OK“ (`frontend/AGENTS.md`, „Knöpfe nennen die
   * Handlung“).
   */
  bestaetigungKnopf?: string;
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
      /**
       * Aktionen UNTER dem Karteninhalt statt rechts daneben (`ListenEintrag` `gestapelt`). Für
       * eine Primäraktion mit langem Etikett: „Aus dem Einsatz nehmen“ ließ dem Inhalt auf 390 px
       * keine 60 px, der Titel brach Buchstabe für Buchstabe um (LLH-1093, Prüfliste).
       */
      gestapelt?: true;
    }
  | {
      art: 'eigen';
      /** Nur mit Eintrag in `datensicht.guard.test.ts` (`KARTEN_EIGENBAU`). */
      render: (ktx: KartenKontext<T>) => ReactNode;
    };

// ── Sortierung, Gruppierung, Baum, Zufluss ───────────────────────────────────────────
/** `null` = Reihenfolge wie geliefert (Serverordnung unangetastet). */
type Sortierung<K extends string> = { spalte: K; richtung: 'auf' | 'ab' } | null;
/** Für Seiten, die die Sortierung kontrolliert führen (Servermodus). */
export type DatensichtSortierung<K extends string> = Sortierung<K>;

/**
 * Gruppenachse; beide Zweige nutzen dieselben Schlüssel und Zähler, nicht dieselbe Form:
 *  · Kartenzweig: echte Gruppenköpfe („verfügbar · 7“) über verschachtelten Listen.
 *  · Tabellenzweig: die Gruppenachse wird FÜHRENDE Sortierachse, Zähler als Streifen in der
 *    Werkzeugzeile. Keine synthetischen Gruppenzeilen: Spaltenfixierung × Zellverbünde sind
 *    ungeprüft, und `KatalogTabelle` fixiert Spalte 0 immer.
 */
interface Gruppierung<T> {
  schluessel: (zeile: T) => string;
  /** Wort hinter der Zahl; `anzahl` für die Einzahl („1 Entwurf“, LFH-1153). */
  etikett: (wert: string, anzahl: number) => string;
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
 * `'sammelbanner'` (Default): solange der Fokus INNERHALB der Sicht liegt oder ein Maus- bzw.
 *   Stiftzeiger über ihr (nicht Touch), bleiben Zeilenmenge und -reihenfolge eingefroren, im Baum
 *   auch Elternzeile und Folge der Kinder ({@link baumZufluss}); Zellinhalte aktualisieren weiter.
 *   Neue Zeilen erscheinen als Banner („7 neue Einträge — anzeigen“, im Baum auch „· 1 umgehängt“).
 * `'sofort'`: kein Einfrieren, nur für Flächen ohne fokussierbare Zeileninhalte.
 */
type Zufluss = 'sammelbanner' | 'sofort';

/** Wartezeit nach dem letzten Tastendruck, bevor der Servermodus den Suchbegriff meldet. */
export const SERVER_SUCHE_ENTPRELLUNG_MS = 300;

/**
 * Servermodus (LFH-1075, Spec `schaden-liste-blaettern`): Suche, Spaltenfilter und Sortierung
 * wirken am Server, `daten` ist schon seine Antwort. Die Sicht meldet Suchbegriff (entprellt,
 * getrimmt) und wirksame Spaltenfilter und zeigt `daten` in der gelieferten Folge, ohne zweite
 * Filterung oder Sortierung. Die Sortierung läuft kontrolliert über `sortierung`/`onSortierung`;
 * `filter.trifft` und `sortWert` bleiben Pflicht, sie tragen nur nichts zur Zeilenmenge bei.
 */
export interface ServerSicht {
  /**
   * Kennung der Abfrage, aus der `daten` stammen (Suche, Filter, Sortierung). Wechselt sie, ist die
   * neue Menge die Antwort auf eine Benutzeraktion: sie erscheint sofort, nicht als Zufluss hinter
   * dem Sammelbanner.
   */
  stand: string;
  onSuche: (begriff: string) => void;
  /** Nur Spalten mit gewähltem Wert; eine leere Auswahl fehlt im Objekt. */
  onFilter: (werte: Readonly<Record<string, readonly string[]>>) => void;
  /**
   * Zahlen für den `Filterhinweis` (LLH-1086), aus einer SERVERZÄHLUNG: Treffer unter Suche und
   * Filter, Gesamtzahl ohne sie. Die Sicht kennt nur das geladene Fenster und zählt deshalb nicht
   * selbst; fehlt eine Zahl, steht keine.
   */
  zahlen?: { treffer?: number; gesamt?: number };
}

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
  /**
   * Tabelle: `locale.emptyText`; Karte: `Liste emptyText`. KEIN neuer Leerzustands-Knoten. Gilt
   * nur für die leere GESAMTMENGE; leert erst Suche oder Filter die Sicht, ersetzt ihn auf
   * demselben Weg der Filter-Leerzustand (LFH-967).
   */
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
  /** Servermodus, siehe {@link ServerSicht}. Schließt `gruppen` und `baum` aus. */
  serverseitig?: ServerSicht;
  /**
   * Gedächtnis der Liste (LLH-1086, `components/listenGedaechtnis.ts`): Sortierung, Filter und
   * Suche beginnen mit dem Stand aus Adresse oder Sitzung und werden entprellt zurückgemeldet; die
   * Spaltenwahl beginnt mit dem Stand des Geräts. Die Vorgabe-Sortierung trägt dann das
   * Gedächtnis (`vorgabe`), nicht `standardSortierung`.
   */
  gedaechtnis?: ListenGedaechtnis<NoInfer<K>>;
  /** Mehrzahl im Dativ für den `Filterhinweis` („12 von 48 Schäden sichtbar“); Vorgabe „Einträgen“. */
  mehrzahl?: string;

  // Spaltensichtbarkeit — Voreinstellung ODER kontrolliert
  spaltenAusVoreinstellung?: readonly NoInfer<K>[];
  spaltenAus?: readonly NoInfer<K>[];
  onSpaltenAus?: (schluessel: NoInfer<K>[]) => void;
  /**
   * Der Spaltenschalter steht bei der Seite, in ihrer eigenen Werkzeugzeile (LLH-1417, Vorbild
   * Meldebild): Zustand aus `useSpaltenSchalterZustand` (`components/SpaltenSchalter.tsx`), die Seite
   * rendert `SpaltenSchalter` damit selbst. Die Sicht liest Spaltenwahl und Offen-Achse von dort,
   * zeichnet keinen eigenen Schalter, und der Fokus auf dem Schalter hält die Zeilenschleuse nicht.
   * Die Werkzeugzeile der Sicht bleibt als Standzeile des Sammelbanners. Schließt
   * `spaltenAus`/`spaltenAusVoreinstellung` und die Spaltenwahl aus `gedaechtnis` aus.
   */
  spaltenSchalterAussen?: SpaltenSchalterZustand<NoInfer<K>>;

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
  /**
   * Grund der letzten abgelehnten Aktion an dieser Zeile (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“), aus `components/useZeilenFehler.ts`. Er steht als `ZeilenFehler` in
   * der Kennungszelle bzw. unten in der Karte. Den Grund liefert dasselbe Objekt, solange er gilt:
   * gemerkte Zeilen zeichnen neu, wenn es sich ändert, und nur dann. Schließt `baum` aus.
   */
  zeilenFehler?: (zeile: T) => ZeilenGrund | null;
  /**
   * Ein Popover, Menü oder Dialog einer Zeile ist offen (LLH-1130, Spec `betroffene-lagedaten`):
   * die Schleuse hält Menge und Folge wie bei Fokus, auch ohne Fokus und Zeiger in der Sicht
   * (Touch, Portal). Die Menüs des Kartenfußs (`weitere`) melden sich selbst.
   */
  halten?: boolean;
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
 * DIE SCHLEUSE IM BAUM (LFH-1020, Spec `datensicht-zufluss`): dieselbe reine Logik wie das Gerüst
 * `HaengenderBaum` (`organigramm/baumSchleuse.ts`), über einen Adapter. Gehalten werden Menge,
 * Elternzeile und Folge auf JEDER Ebene; der Inhalt kommt je Schlüssel frisch, ein umgehängter
 * Knoten steht mit gehaltenem Inhalt am alten Ort.
 *
 * Anders als im Gerüst fällt Entfallenes sofort weg (wie flach): eine Tabellenzeile stützt kein
 * Spalten-Grid, ein Platzhalter wäre eine eigene Darstellung. Deshalb zählt `wartend.entfallen`
 * hier nicht.
 *
 * Eine Zeile, deren gezeigte Kinder dieselben Objekte sind wie ihre eigenen, kommt REFERENZGLEICH
 * zurück: die gemerkten Zeilen (LFH-949) rendern sonst bei jedem Datenstand neu.
 */
export function baumZufluss<T extends object>(args: {
  gehalten: readonly T[];
  frisch: readonly T[];
  kinder: KinderFeld<T>;
  schluessel: (zeile: T) => Key;
}): { zeilen: readonly T[]; wartend: Omit<Wartend, 'entfallen'> } {
  const { gehalten, frisch, kinder, schluessel } = args;
  interface Knoten {
    key: string;
    kinder: readonly Knoten[];
    zeile: T;
  }
  const kinderVon = (z: T) => (z[kinder] as readonly T[] | undefined) ?? [];
  const knoten = (z: T): Knoten => ({
    key: String(schluessel(z)),
    kinder: kinderVon(z).map(knoten),
    zeile: z,
  });
  const stand = baumSchleuse(gehalten.map(knoten), frisch.map(knoten));
  const zurueck = (ks: readonly Knoten[]): T[] =>
    ks
      .filter((k) => !stand.entfallen.has(k.key))
      .map((k) => {
        const gezeigt = zurueck(k.kinder);
        const eigene = kinderVon(k.zeile);
        const gleich = gezeigt.length === eigene.length && gezeigt.every((z, i) => z === eigene[i]);
        return gleich ? k.zeile : ({ ...k.zeile, [kinder]: gezeigt } as T);
      });
  const { neu, umgehaengt, umsortiert } = stand.wartend;
  return { zeilen: zurueck(stand.gezeigt), wartend: { neu, umgehaengt, umsortiert } };
}

export { bannerText };

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
    .map((wert) => {
      const zeilen = eimer.get(wert)!;
      return { wert, etikett: gruppen.etikett(wert, zeilen.length), zeilen };
    });
}

/**
 * Zähler einer Gruppe: Zahl vor Wort („6 gebunden“), wie in der Verdichtungszeile (LFH-973,
 * Klärungsrunde Welle 4, Entscheidung 2). Rein und exportiert.
 */
export function gruppenZahl(g: { etikett: string; zeilen: readonly unknown[] }): string {
  return `${g.zeilen.length} ${g.etikett}`;
}

/** Klasse, die eine per Deeplink angesteuerte Zeile markiert (LFH-25). */
export const HERVORGEHOBEN = 'zeile-hervorgehoben';

/**
 * Bedienziele in einer Zeile, deren Klick nicht zusätzlich als Zeilenklick zählt — für
 * `onZeileKlick` und das Aufklappen im Baum dieselbe Menge (LFH-548, LLH-1050).
 */
const ZEILEN_BEDIENZIEL = 'a, button, input, select, textarea, [role="button"]';

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
    | 'spalten'
    | 'karte'
    | 'suche'
    | 'baum'
    | 'gruppen'
    | 'aufklappen'
    | 'onZeileKlick'
    | 'serverseitig'
    | 'zeilenFehler'
  >,
  bezeichnung: string,
): string[] {
  const {
    spalten,
    karte,
    suche,
    baum,
    gruppen,
    aufklappen,
    onZeileKlick,
    serverseitig,
    zeilenFehler,
  } = props;
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
    // Die gezeigten Gründe merkt sich die Tabelle nur für die oberste Ebene; an einem Baumkind
    // bliebe ein geräumter Grund hinter `shouldCellUpdate` stehen (LFH-1077).
    if (zeilenFehler) befunde.push('zeilenFehler und baum schließen sich aus.');
  }
  // Die Gruppenachse sortiert im Client; über eine geblätterte Servermenge zählte sie nur das Fenster.
  if (serverseitig && gruppen) befunde.push('serverseitig und gruppen schließen sich aus.');
  if (serverseitig && baum) befunde.push('serverseitig und baum schließen sich aus.');
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

// ── Ausschnitt großer Listen (LFH-949) ───────────────────────────────────────────────

/**
 * Ab wie vielen Zeilen auf oberster Ebene (nach Suche und Filter) `Datensicht` nur den Sichtbereich
 * rendert. Darunter ändert sich nichts. Herleitung: `/mnt/project-files/lfh-949/design.md`, D1.
 */
export const DATENSICHT_SCHWELLE = 200;

interface FensterTraeger {
  oben: number;
  unten: number;
  spaltenZahl: number;
  /** Alle Zeilen der Tabelle für `aria-rowcount`; `null` ohne Zeilennummern (Baum, Aufklappen). */
  zeilenZahl: number | null;
  setzeStart: (el: HTMLElement | null) => void;
}

/**
 * Trägt den Ausschnitt in antds `components`. Die Komponenten stehen auf Modulebene, damit rc-table
 * bei jedem Render dieselben bekommt und den Tabellenkörper nicht neu aufbaut.
 */
const FensterKontext = createContext<FensterTraeger | null>(null);

/**
 * Die Schlüssel der Spalten, die die Tabelle gerade zeigt; `null` im Kartenzweig. Aus derselben
 * Sichtbarkeitswahrheit wie Zähler und Häkchen (Breite UND Handwahl, `sichtbareSpalten`).
 */
const GezeigteSpaltenKontext = createContext<ReadonlySet<string> | null>(null);

/**
 * `true`, solange die Tabelle steht und die Spalte `key` darin ausgeblendet ist, per Breite oder
 * von Hand. Für eine Zelle, die den Wert einer weggefallenen Spalte mitträgt (Materialliste:
 * Kategorie als zweite Zeile unter der Bezeichnung, LLH-1093). Im Kartenzweig `false`: die Karte
 * hat ihren eigenen Plan.
 */
export function useSpalteAusgeblendet(key: string): boolean {
  const gezeigt = useContext(GezeigteSpaltenKontext);
  return gezeigt != null && !gezeigt.has(key);
}

function Platzhalterzeile(props: {
  hoehe: number;
  spalten: number;
  zeigerRef?: (el: HTMLElement | null) => void;
  ende?: boolean;
}) {
  return (
    <tr
      ref={props.zeigerRef}
      aria-hidden
      data-lfh="datensicht-platzhalter"
      {...(props.ende ? { [FENSTER_ENDE]: '' } : {})}
    >
      <td colSpan={props.spalten} style={{ height: props.hoehe, padding: 0, border: 0 }} />
    </tr>
  );
}

function FensterKoerper({ children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  const f = useContext(FensterKontext);
  if (!f) return <tbody {...rest}>{children}</tbody>;
  return (
    <tbody {...rest}>
      <Platzhalterzeile hoehe={f.oben} spalten={f.spaltenZahl} zeigerRef={f.setzeStart} />
      {children}
      <Platzhalterzeile hoehe={f.unten} spalten={f.spaltenZahl} ende />
    </tbody>
  );
}

function FensterTabelle(props: TableHTMLAttributes<HTMLTableElement>) {
  const f = useContext(FensterKontext);
  // Mit stehender Kopfzeile liegt der Kopf in einer eigenen Tabelle (`header.table`): gezählt
  // werden hier nur die Datenzeilen.
  return <table {...props} aria-rowcount={f?.zeilenZahl ?? undefined} />;
}

const FENSTER_KOMPONENTEN = { table: FensterTabelle, body: { wrapper: FensterKoerper } };

// ── Gemerktes Rendern (LFH-949, D4/D5) ───────────────────────────────────────────────

/**
 * Die GARNITUR ist alles, was eine Zelle oder Karte außer ihrem Datensatz liest: Spalten,
 * Kartenplan, Sortierung, Token, Aufklapp- und Baumzustand. Ändert sich ein Teil (nach Identität),
 * steigt die Nummer, und `neu` ist für diesen Render wahr; dann rendert alles wie bisher.
 *
 * Verglichen wird gegen den zuletzt GEZEIGTEN Stand (Ref, nach dem Commit gesetzt): ein
 * verworfener oder doppelter Render (StrictMode) sieht denselben Vergleich.
 */
function useGarnitur(werte: readonly unknown[]): { nummer: number; neu: boolean } {
  const gezeigt = useRef<{ werte: readonly unknown[]; nummer: number } | null>(null);
  const alt = gezeigt.current;
  const gleich =
    alt != null &&
    alt.werte.length === werte.length &&
    alt.werte.every((w, i) => Object.is(w, werte[i]));
  const nummer = gleich ? alt.nummer : (alt?.nummer ?? 0) + 1;
  useLayoutEffect(() => {
    gezeigt.current = { werte, nummer };
  });
  return { nummer, neu: !gleich };
}

/**
 * Zellen, die die Uhr lesen („1430“ heute, „161430“ sonst, `zeitKurz`), sähen den Tageswechsel
 * sonst erst mit dem nächsten geänderten Datensatz. Die Viertelstunde trifft jede Tagesgrenze der
 * Anzeigezone, auch halbstündig versetzte; der erste Render danach zeichnet alles neu.
 */
function viertelstunde(): number {
  return Math.floor(Date.now() / 900_000);
}

interface GemerkteKarteProps {
  /** Zeichnet die Karte mit dem Stand des jetzigen Renders; zählt nicht zum Vergleich. */
  zeichne: () => ReactNode;
  zeile: unknown;
  index: number;
  tiefe: number;
  offen: boolean;
  klasse: string | undefined;
  /** Zeilenfehler der Karte; verglichen nach Identität wie der Datensatz. */
  fehler: ZeilenGrund | null;
  garnitur: number;
}

/**
 * Eine Karte rendert nur bei geändertem Datensatz, geänderter Lage, Aufklappzustand, Klasse,
 * Zeilenfehler oder neuer Garnitur (D5). `zeichne` ist je Render neu und wird nicht verglichen:
 * wenn die Karte rendert, nimmt sie den jüngsten Stand, und alles, was sie außer dem Datensatz
 * liest, steht in der Garnitur.
 */
const GemerkteKarte = memo(
  function GemerkteKarte({ zeichne }: GemerkteKarteProps) {
    return zeichne();
  },
  (a, b) =>
    a.zeile === b.zeile &&
    a.index === b.index &&
    a.tiefe === b.tiefe &&
    a.offen === b.offen &&
    a.klasse === b.klasse &&
    a.fehler === b.fehler &&
    a.garnitur === b.garnitur,
);

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
    serverseitig,
    spaltenAusVoreinstellung,
    spaltenAus,
    onSpaltenAus,
    spaltenSchalterAussen: aussen,
    zeilenKlasse,
    onZeileKlick,
    werkzeuge,
    aufklappen,
    zeilenFehler,
    halten = false,
    gedaechtnis,
    mehrzahl,
  } = props;

  const { token } = theme.useToken();
  const { getPrefixCls, locale: antdLocale } = useContext(ConfigProvider.ConfigContext);
  const tabellenPraefix = getPrefixCls('table');
  const tabellenText = antdLocale?.Table;
  const { abBreite, istSchmal } = useViewport();
  const baumEinzug = istSchmal ? BAUM_EINZUG_SCHMAL_PX : BAUM_EINZUG_PX;
  const wurzel = useRef<HTMLElement>(null);
  const werkzeugWurzel = useRef<HTMLDivElement>(null);

  /**
   * DIE ZEILENSCHLEUSE (Kriterium 12): Zustand und Benutzeraktion aus `useZuflussSteuerung`
   * (`components/useZuflussSchleuse.ts`), damit `ListeDetail` dieselbe Schleuse trägt. Hier, vor den
   * Settern, weil jede Sortier-, Such- und Filteränderung `nachBenutzeraktion` ruft.
   */
  const zuflussSteuerung = useZuflussSteuerung<T>();
  const { stand: schleuse, nachBenutzeraktion } = zuflussSteuerung;
  const gefroren = schleuse.art === 'gefroren' ? schleuse.folge : null;
  const gefroreneGruppeVon = schleuse.art === 'gefroren' ? schleuse.gruppeVon : null;
  const gefrorenesGerippe = schleuse.art === 'gefroren' ? schleuse.gerippe : null;

  // ── Zustand: Voreinstellung ODER kontrolliert, nie beides ──────────────────────────
  const [eigeneSortierung, setEigeneSortierung] = useState<Sortierung<K>>(
    gedaechtnis ? gedaechtnis.start.sortierung : standardSortierung,
  );
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
    () =>
      (gedaechtnis?.spaltenStart?.aus as readonly K[] | undefined) ??
      spaltenAusVoreinstellung ??
      [],
  );
  const aktiveSpaltenAus = aussen?.aus ?? spaltenAus ?? eigeneSpaltenAus;
  // Per Breite weggefallene, von Hand zurückgeholte Spalten. Ohne Schalter bei der Seite bewusst
  // unkontrolliert, weil kein Konsument diese Hälfte braucht.
  const [eigeneSpaltenAn, setSpaltenAn] = useState<readonly K[]>(
    () => (gedaechtnis?.spaltenStart?.an as readonly K[] | undefined) ?? [],
  );
  const spaltenAn = aussen?.an ?? eigeneSpaltenAn;
  /*
   * Schaltet die Seite die Spalten (`spaltenSchalterAussen`), ist das dieselbe Benutzeraktion wie
   * am eingebauten Schalter (siehe `setzeSpaltenAus`): die freigegebenen Zeilen sind die Antwort
   * auf den Klick. Der Anfangsstand zählt nicht.
   */
  const gezeigteWahl = useRef(aussen ? { aus: aussen.aus, an: aussen.an } : null);
  useLayoutEffect(() => {
    if (!aussen) return;
    const alt = gezeigteWahl.current;
    gezeigteWahl.current = { aus: aussen.aus, an: aussen.an };
    if (alt == null || (alt.aus === aussen.aus && alt.an === aussen.an)) return;
    nachBenutzeraktion();
  }, [aussen, nachBenutzeraktion]);
  const meldeSpalten = gedaechtnis?.meldeSpalten;
  const setzeSpaltenAus = useCallback(
    (k: K[]) => {
      if (spaltenAus === undefined) setEigeneSpaltenAus(k);
      onSpaltenAus?.(k);
      meldeSpalten?.({ aus: k, an: spaltenAn });
      // Eine Spaltenumschaltung IST eine Benutzeraktion: blendet man eine gefilterte Spalte aus, wird
      // ihr Filter unwirksam, und die freigegebenen Zeilen sind die Antwort auf den Klick, kein
      // Zufluss. Ohne diesen Aufruf zählte die Schleuse sie als neu. Greift nur für den eingebauten
      // Schalter (keine Seite nutzt den kontrollierten Weg).
      nachBenutzeraktion();
    },
    [spaltenAus, onSpaltenAus, nachBenutzeraktion, meldeSpalten, spaltenAn],
  );
  const setzeSpaltenAn = useCallback(
    (k: K[]) => {
      setSpaltenAn(k);
      meldeSpalten?.({ aus: aktiveSpaltenAus, an: k });
      // Aus demselben Grund wie oben: die freigegebenen Zeilen sind die Antwort auf den Klick.
      nachBenutzeraktion();
    },
    [nachBenutzeraktion, meldeSpalten, aktiveSpaltenAus],
  );

  const [suchbegriff, setSuchbegriff] = useState(() => gedaechtnis?.start.suche ?? '');
  const [filterWerte, setFilterWerte] = useState<Readonly<Record<string, readonly string[]>>>(
    () => gedaechtnis?.start.filter ?? {},
  );
  const filterZuruecksetzen = useCallback(() => {
    setSuchbegriff('');
    setFilterWerte({});
    nachBenutzeraktion();
  }, [nachBenutzeraktion]);
  /** Einen Filter einer Spalte setzen; ein leerer fällt aus dem Zustand (und aus der Adresse). */
  const setzeFilter = useCallback(
    (spalte: string, werte: readonly string[]) => {
      setFilterWerte((vorher) => {
        const { [spalte]: _alt, ...rest } = vorher;
        void _alt;
        return werte.length > 0 ? { ...rest, [spalte]: werte } : rest;
      });
      nachBenutzeraktion();
    },
    [nachBenutzeraktion],
  );

  /**
   * DAS GEDÄCHTNIS HÖRT MIT (LLH-1086): jede Änderung von Sortierung, Filter oder Suche geht
   * entprellt an `gedaechtnis.melde` (Adresse und Sitzung), der Anfangsstand nicht — er kommt ja
   * von dort. Beim Aushängen wird nichts nachgemeldet: die Seite ist dann schon weg, eine
   * Adressänderung führte zurück.
   */
  const melde = gedaechtnis?.melde;
  const ersterStand = useRef(true);
  useEffect(() => {
    if (ersterStand.current) {
      ersterStand.current = false;
      return;
    }
    if (!melde) return;
    const frist = setTimeout(
      () => melde({ sortierung: aktiveSortierung, filter: filterWerte, suche: suchbegriff }),
      GEDAECHTNIS_ENTPRELLUNG_MS,
    );
    return () => clearTimeout(frist);
  }, [melde, aktiveSortierung, filterWerte, suchbegriff]);

  // ── Formwahl ──────────────────────────────────────────────────────────────────────
  // Steht HIER, weil die Ebenen-Registrierung darunter sie liest: der Spaltenschalter existiert
  // nur im Tabellenzweig.
  const alsTabelle = form === 'tabelle' || (form === 'auto' && abBreite('md'));

  const [eigenesSpaltenOffen, setEigenesSpaltenOffen] = useState(false);
  const spaltenOffen = aussen ? aussen.offen : eigenesSpaltenOffen;
  const setSpaltenOffen = aussen ? aussen.onOffen : setEigenesSpaltenOffen;

  // Steht der Schalter überhaupt? EINE Wahrheit für Palettenmeldung, Rücksetzer und Schalter.
  const spaltenSchalterDa = alsTabelle && hatWaehlbareSpalten(spalten);

  /*
   * Verschwindet der Schalter, feuert antd KEIN `onOpenChange(false)`; der kontrollierte Zustand
   * bliebe `true`, und das Overlay klappte beim Wiederauftauchen unaufgefordert auf. Der Riegel
   * hängt an Breite UND Spaltengarnitur.
   */
  useEffect(() => {
    if (!spaltenSchalterDa) setSpaltenOffen(false);
  }, [spaltenSchalterDa, setSpaltenOffen]);

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
  const gezeigteSpaltenSchluessel = useMemo(
    () => new Set(gezeigteSpalten.map((s) => s.key as string)),
    [gezeigteSpalten],
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
  /**
   * Filter ohne Spalte (LLH-1276): Spalten, die in der Tabelle NUR der Breite weichen und deren
   * Filter `feldOhneSpalte` trägt. Ihr Filter steht als Feld in der Werkzeugzeile, ist also zu
   * sehen und wirkt. Von Hand ausgeblendet (`verborgen`) gehört keine dazu.
   */
  const feldSpalten = useMemo(
    () =>
      alsTabelle && baum == null
        ? spalten.filter(
            (s) =>
              s.filter?.feldOhneSpalte === true &&
              !gezeigteSpaltenSchluessel.has(s.key) &&
              !verborgen.has(s.key),
          )
        : [],
    [alsTabelle, baum, spalten, gezeigteSpaltenSchluessel, verborgen],
  );
  const wirksameFilterWerte = useMemo(() => {
    const sichtbar = new Set([...gezeigteSpalten, ...feldSpalten].map((s) => s.key as string));
    return Object.fromEntries(Object.entries(filterWerte).filter(([k]) => sichtbar.has(k)));
  }, [filterWerte, gezeigteSpalten, feldSpalten]);

  // ── Servermodus: Werte melden statt anwenden (LFH-1075) ─────────────────────────────
  const server = useRef(serverseitig);
  useLayoutEffect(() => {
    server.current = serverseitig;
  });
  const imServermodus = serverseitig != null;

  // Der erste Wert geht sofort hinaus, damit die Seite nach einem Neuaufbau der Sicht nicht mit
  // einem alten Begriff weiterliest; jeder weitere erst nach der Entprellung.
  const gemeldeteSuche = useRef<string | null>(null);
  useEffect(() => {
    if (!imServermodus) return;
    const begriff = suchbegriff.trim();
    if (begriff === gemeldeteSuche.current) return;
    const melden = () => {
      gemeldeteSuche.current = begriff;
      server.current?.onSuche(begriff);
    };
    if (gemeldeteSuche.current === null) {
      melden();
      return;
    }
    const frist = setTimeout(melden, SERVER_SUCHE_ENTPRELLUNG_MS);
    return () => clearTimeout(frist);
  }, [imServermodus, suchbegriff]);

  const gemeldeteFilter = useRef<string | null>(null);
  useEffect(() => {
    if (!imServermodus) return;
    const gewaehlt = Object.fromEntries(
      Object.entries(wirksameFilterWerte).filter(([, w]) => w.length > 0),
    );
    const kennung = JSON.stringify(gewaehlt);
    if (kennung === gemeldeteFilter.current) return;
    gemeldeteFilter.current = kennung;
    server.current?.onFilter(gewaehlt);
  }, [imServermodus, wirksameFilterWerte]);

  // ── Die Zeilenmenge ───────────────────────────────────────────────────────────────
  const zeilen = useMemo(
    () =>
      imServermodus
        ? daten
        : effektiveDaten({
            daten,
            spalten,
            sortierung: aktiveSortierung,
            suchbegriff,
            filterWerte: wirksameFilterWerte,
            gruppen,
            baum: baum != null,
          }),
    [
      imServermodus,
      daten,
      spalten,
      aktiveSortierung,
      suchbegriff,
      wirksameFilterWerte,
      gruppen,
      baum,
    ],
  );

  /**
   * DER LEERZUSTAND NENNT SEINEN GRUND (LFH-967). Leert erst eine Einschränkung die Sicht, sagt
   * „Keine Betreuungsstellen“ das Falsche, während der Kopf „71 untergebracht“ zeigt. Dann steht
   * der Filter-Leerzustand samt Rückweg da; der modulspezifische `leerText` bleibt der leeren
   * Gesamtmenge. Gezählt wird, was WIRKT (`wirksameFilterWerte`): ein Filter einer verborgenen
   * Spalte schneidet nichts und erklärt deshalb auch nichts.
   */
  const einschraenkungAktiv =
    suchbegriff.trim() !== '' || Object.values(wirksameFilterWerte).some((w) => w.length > 0);
  const leerInhalt: ReactNode =
    // Im Servermodus IST `daten` schon die eingeschränkte Menge.
    einschraenkungAktiv && (daten.length > 0 || imServermodus) ? (
      // Der Rückweg steht im `Filterhinweis` darüber (LLH-1086), ein zweiter Knopf hieße gleich.
      <Typography.Text type="secondary">Keine Treffer für die gewählten Filter</Typography.Text>
    ) : (
      leerText
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
          // antds Icon bringt `role="img"` mit englischem Namen mit; die Hülle nimmt es aus dem
          // Vorlesebaum.
          <span aria-hidden="true" style={{ display: 'inline-flex' }}>
            {offen ? <IconChevronRunter /> : <IconChevronRechts />}
          </span>
        }
      >
        {aufklappen.etikett}
      </Button>
    );
  };

  const baumKinder = baum?.kinder;
  /**
   * IM DRUCK GILT DIE SCHLEUSE NICHT (wie im Gerüst): Strg+P mit Fokus oder Zeiger in der Sicht
   * unterschlüge sonst, was hinter dem Banner wartet. Danach hält sie wieder den alten Stand.
   */
  const druckt = useDruckModus();
  const { sichtbareZeilen, banner } = useMemo(() => {
    if (!gefroren || druckt) return { sichtbareZeilen: zeilen, banner: null };
    if (gefrorenesGerippe && baumKinder) {
      const z = baumZufluss({
        gehalten: gefrorenesGerippe,
        frisch: zeilen,
        kinder: baumKinder,
        schluessel,
      });
      return { sichtbareZeilen: z.zeilen, banner: bannerText(z.wartend) };
    }
    const flach = flachZufluss(gefroren, zeilen, schluessel);
    return { sichtbareZeilen: flach.zeilen, banner: flach.banner };
  }, [gefroren, druckt, gefrorenesGerippe, baumKinder, zeilen, schluessel]);

  /**
   * Im Servermodus kommt die Antwort auf Suche, Filter oder Sortierklick erst nach der
   * Benutzeraktion an; ihr Eintreffen (neuer `stand`) ist deshalb selbst der Auftrag, neu
   * einzufrieren. Live-Zeilen im selben Stand bleiben Zufluss.
   */
  const serverStand = serverseitig?.stand;
  const letzterServerStand = useRef(serverStand);
  useLayoutEffect(() => {
    if (letzterServerStand.current === serverStand) return;
    letzterServerStand.current = serverStand;
    nachBenutzeraktion();
  }, [serverStand, nachBenutzeraktion]);

  /**
   * Offene Menüs des Kartenfußs (`weitere`) halten die Sicht wie `halten` der Seite. Ein Schlüssel
   * je Karte; der Auslöser meldet „zu“, auch wenn er mit offenem Menü aushängt.
   */
  const [kartenMenueOffen, setKartenMenueOffen] = useState<ReadonlySet<Key>>(() => new Set());
  const reportKartenMenue = useCallback((k: Key, offen: boolean) => {
    setKartenMenueOffen((alt) => {
      if (alt.has(k) === offen) return alt;
      const neu = new Set(alt);
      if (offen) neu.add(k);
      else neu.delete(k);
      return neu;
    });
  }, []);

  // Einfrieren, Fokus- und Zeigerbedingung: `useZuflussSchleuse` (Spec `datensicht-zufluss`).
  const zuflussBereich = useZuflussSchleuse(zuflussSteuerung, {
    zeilen,
    schluessel,
    aktiv: zufluss === 'sammelbanner',
    gruppeVon: gruppen?.schluessel,
    mitGerippe: baumKinder != null,
    wurzel,
    halten: halten || kartenMenueOffen.size > 0,
  });

  // ── DEV-Diagnose ──────────────────────────────────────────────────────────────────
  /**
   * `useMemo` über die Eingaben, Effekt über einen PRIMITIVEN Schlüssel: die Aufrufer bauen
   * Kartenplan und Spaltenliste je Render neu, ein Effekt über die Objekte flutete die Konsole.
   */
  const befunde = useMemo(
    () =>
      pruefeKartenplan(
        {
          spalten,
          karte,
          suche,
          baum,
          gruppen,
          aufklappen,
          onZeileKlick,
          serverseitig,
          zeilenFehler,
        },
        bezeichnung,
      ),
    [
      spalten,
      karte,
      suche,
      baum,
      gruppen,
      aufklappen,
      onZeileKlick,
      serverseitig,
      zeilenFehler,
      bezeichnung,
    ],
  );
  const befundSchluessel = befunde.join(' | ');
  useEffect(() => {
    if (!import.meta.env.DEV || befundSchluessel === '') return;
    console.warn(`[Datensicht: ${bezeichnung}] ${befundSchluessel}`);
  }, [befundSchluessel, bezeichnung]);

  // ── Werkzeugzeile ─────────────────────────────────────────────────────────────────
  const filterSpalten = [...gezeigteSpalten.filter((s) => s.filter != null), ...feldSpalten];
  /** „Ort, aufsteigend“ / „Ort, absteigend“ je sortierbarer Spalte, für den Kartenzweig. */
  const sortierOptionen = spalten.flatMap((s) => {
    if (!s.sortWert || 'children' in s) return [];
    const etikett = etikettVon(s) ?? s.key;
    return [
      { value: `${s.key}:auf`, label: `${etikett}, aufsteigend` },
      { value: `${s.key}:ab`, label: `${etikett}, absteigend` },
    ];
  });
  /** Chips und Merkmale aus den WIRKSAMEN Filtern: was man nicht sieht, wirkt nicht. */
  const filterListe = aktiveFilter(
    filterSpalten.map((s) => ({
      key: s.key,
      etikett: etikettVon(s) ?? s.key,
      werte: s.filter!.werte,
    })),
    wirksameFilterWerte,
  );
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
  const gruppenKarten = useMemo(
    () => (gruppenAchse ? gruppiere(sichtbareZeilen, gruppenAchse) : []),
    [gruppenAchse, sichtbareZeilen],
  );

  // ── Ausschnitt (LFH-949) ──────────────────────────────────────────────────────────
  /**
   * Ab {@link DATENSICHT_SCHWELLE} Zeilen rendert nur der Sichtbereich plus Überhang; Platzhalter
   * tragen die Höhe der übrigen (`fensterAusschnitt.ts`). Geschnitten wird nur, was gerendert wird,
   * nie die Folge: die Schleuse oben bleibt, wie sie ist (D2). Im Druck rendert alles.
   *
   * Die FOLGE ist die Reihenfolge auf dem Schirm: im gruppierten Kartenzweig nach Gruppen, sonst
   * `sichtbareZeilen`. Im Baum zählt nur die oberste Ebene; Kinder zählen zur Höhe ihres Knotens.
   */
  const virtuell = !druckt && sichtbareZeilen.length > DATENSICHT_SCHWELLE;
  const kartenGruppiert = !alsTabelle && gruppen != null && !baum;
  const folge = useMemo(
    () => (kartenGruppiert ? gruppenKarten.flatMap((g) => g.zeilen) : sichtbareZeilen),
    [kartenGruppiert, gruppenKarten, sichtbareZeilen],
  );
  const folgeSchluessel = useMemo(() => folge.map(schluessel), [folge, schluessel]);
  const indexVon = useMemo(
    () => new Map(folgeSchluessel.map((k, i) => [k, i] as const)),
    [folgeSchluessel],
  );
  // Deeplink (D3): die hervorgehobene Zeile muss im Ausschnitt stehen, auch weit unten.
  const ankerSchluessel = useMemo(() => {
    if (!virtuell || !zeilenKlasse) return null;
    const ziel = folge.find((z) => (zeilenKlasse(z) ?? '').split(/\s+/).includes(HERVORGEHOBEN));
    return ziel ? schluessel(ziel) : null;
  }, [virtuell, zeilenKlasse, folge, schluessel]);
  const fensterStart = useRef<HTMLElement | null>(null);
  const setzeFensterStart = useCallback((el: HTMLElement | null) => {
    fensterStart.current = el;
  }, []);
  const ausschnitt = useFensterAusschnitt({
    schluessel: folgeSchluessel,
    aktiv: virtuell,
    // Startwert, bis gemessen ist: eine Tabellenzeile, eine Karte mit Titel und Feldern.
    schaetzung: alsTabelle ? token.controlHeight + token.paddingSM : token.controlHeight * 3,
    start: fensterStart,
    wurzel,
    anker: ankerSchluessel,
  });
  const fensterAttribute = (zeile: T): HTMLAttributes<HTMLElement> =>
    ({ [FENSTER_EINTRAG]: String(schluessel(zeile)) }) as HTMLAttributes<HTMLElement>;

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
              // Schrumpfbar statt `width: 100%`: bei 390 px stehen Suche und „Sortieren“ in EINER
              // Zeile, die erste Karte bleibt im ersten Bild (`betroffene-handy.spec.ts`).
              flex: '1 1 140px',
              minWidth: 0,
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
        {/* Sortierauswahl des Kartenzweigs (LLH-1086): die Karte hat keinen Kopf, der Pfeil fehlt. */}
        {!alsTabelle && sortierOptionen.length > 0 && (
          <Select
            allowClear
            aria-label="Sortieren"
            prefix={
              <span aria-hidden="true" style={{ color: token.colorTextDescription }}>
                Sortieren:
              </span>
            }
            placeholder="wie geliefert"
            value={
              aktiveSortierung
                ? `${aktiveSortierung.spalte}:${aktiveSortierung.richtung}`
                : undefined
            }
            onChange={(wert?: string) => {
              if (!wert) {
                setzeSortierung(null);
                return;
              }
              const trenner = wert.lastIndexOf(':');
              setzeSortierung({
                spalte: wert.slice(0, trenner) as K,
                richtung: wert.slice(trenner + 1) === 'ab' ? 'ab' : 'auf',
              });
            }}
            options={sortierOptionen}
            // Neben der Suche in derselben Zeile (siehe dort); ein langer Wert kürzt mit Auslassung.
            style={{ flex: '1 1 160px', minWidth: 0, maxWidth: 280 }}
          />
        )}
        {/* Im Tabellenzweig sitzt der Filter im Spaltenkopf (LLH-1086); die Karte hat keinen Kopf
            und behält das Auswahlfeld je Filterspalte. In der Tabelle bekommt nur eine Spalte,
            die mit `feldOhneSpalte` der Breite weicht, das Feld (LLH-1276). */}
        {baum == null &&
          (alsTabelle
            ? feldSpalten
            : filterSpalten.filter((spalte) => !spalte.filter!.ohneKartenfeld)
          ).map((spalte) => (
            <Select
              key={spalte.key}
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              // Eigene Kennung: ohne sie vergibt antd im Test eine feste (`test-id`), die mit der
              // Titelkennung eines Dialogs auf derselben Seite kollidiert.
              id={`${idPraefix}-filter-${idTeil(spalte.key)}`}
              aria-label={etikettVon(spalte) ?? spalte.key}
              /*
               * Das Etikett steht als PRÄFIX im Feld (LFH-967): nach der Wahl verschwindet der
               * Platzhalter, und „Anlaufstelle ×“ allein sagt nicht, zu welcher Achse der Wert
               * gehört. Der zugängliche Name trägt es schon, deshalb `aria-hidden`.
               */
              prefix={
                <span aria-hidden="true" style={{ color: token.colorTextDescription }}>
                  {etikettVon(spalte) ?? spalte.key}:
                </span>
              }
              placeholder="alle"
              value={[...(filterWerte[spalte.key] ?? [])]}
              onChange={(werte: string[]) => setzeFilter(spalte.key, werte)}
              options={spalte.filter!.werte.map((w) => ({ value: w.value, label: w.text }))}
              style={{ minWidth: 160 }}
            />
          ))}
        {/* Steht der Schalter bei der Seite (`spaltenSchalterAussen`), zeichnet ihn nur sie. */}
        {alsTabelle && !aussen && (
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
        {/* ZAHL VOR WORT, MIT SICHTBAREM TRENNER (LFH-973): „1 verfügbar · 6 gebunden · 1 nicht
            verfügbar“. Wort vor Zahl und nur ein Abstand dazwischen las sich als „6 nicht
            verfügbar“. Der Punkt ist Optik; vorgelesen trennen die Glieder sich selbst. */}
        {gruppenZaehler.length > 0 && alsTabelle && (
          <Typography.Text type="secondary" data-lfh="datensicht-gruppenzaehler">
            {gruppenZaehler.map((g, i) => (
              <Fragment key={g.wert}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                <span style={{ whiteSpace: 'nowrap' }}>{gruppenZahl(g)}</span>
              </Fragment>
            ))}
          </Typography.Text>
        )}
        {banner != null && (
          // Sammelbanner statt eingeschobener Zeilen (WCAG 3.2.5). Kein `danger`: Rot bedient nichts.
          <Button type="primary" onClick={nachBenutzeraktion}>
            {banner}
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
  /**
   * Zähler je Filterwert („Groß (3)“, LLH-1086): wie viele Zeilen der Wert unter Suche und den
   * ÜBRIGEN Filtern hätte — der eigene Filter zählt nicht mit, sonst stünden alle anderen Werte auf 0.
   * `null` im Servermodus (nur das geladene Fenster) und im Baum (keine Filter).
   */
  // Als Zeichenkette gemerkt: die Zähler gehen in die Spalten und damit in die Garnitur, und ein
  // neuer Datenstand mit gleichen Zählern darf nicht jede Zelle neu zeichnen (LFH-949, D4).
  const zaehlStand = useMemo(() => {
    if (imServermodus || baum) return null;
    const ergebnis: [string, [string, number][]][] = [];
    for (const spalte of gezeigteSpalten) {
      if (!spalte.filter) continue;
      const { [spalte.key]: _eigen, ...uebrige } = wirksameFilterWerte;
      void _eigen;
      const menge = effektiveDaten({
        daten,
        spalten,
        sortierung: null,
        suchbegriff,
        filterWerte: uebrige,
        baum: false,
      });
      ergebnis.push([
        spalte.key,
        spalte.filter.werte.map((w) => [
          w.value,
          menge.filter((z) => spalte.filter!.trifft(z, w.value)).length,
        ]),
      ]);
    }
    return JSON.stringify(ergebnis);
  }, [imServermodus, baum, gezeigteSpalten, wirksameFilterWerte, daten, spalten, suchbegriff]);
  const filterZaehlung = useMemo(
    () =>
      zaehlStand == null
        ? null
        : new Map(
            (JSON.parse(zaehlStand) as [string, [string, number][]][]).map(
              ([k, werte]) => [k, new Map(werte)] as const,
            ),
          ),
    [zaehlStand],
  );
  const kopfStilGefiltert = useMemo(() => kopfGefiltertStil(rollenwerte(token)), [token]);

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
            const stil = kennungsLinkStil({ controlHeight: token.controlHeight });
            return nach == null ? (
              <span style={stil}>{zelle(spalte, zeile, index)}</span>
            ) : (
              <Link to={nach} style={stil}>
                {zelle(spalte, zeile, index)}
              </Link>
            );
          };
        }

        /**
         * DER FILTER IM KOPF (LLH-1086): antd zeichnet Trichter und Menü, der Zustand ist
         * KONTROLLIERT (`filteredValue`) und ohne `onFilter` — antd filtert damit nicht selbst,
         * gefiltert wird in `effektiveDaten` bzw. am Server (Zusicherung 2). Im Clientmodus trägt
         * jeder Wert seinen Zähler; im Servermodus sähe die Sicht nur das geladene Fenster.
         */
        if (filter) {
          const gewaehlt = filterWerte[spalte.key] ?? [];
          const zaehler = filterZaehlung?.get(spalte.key);
          gebaut.filters = filter.werte.map((w) => ({
            text: zaehler ? `${w.text} (${zaehler.get(w.value) ?? 0})` : w.text,
            value: w.value,
          }));
          gebaut.filteredValue = gewaehlt.length > 0 ? [...gewaehlt] : null;
          gebaut.filterMultiple = true;
          if (gewaehlt.length > 0) {
            const eigen = antd.onHeaderCell;
            gebaut.onHeaderCell = (s) => {
              const basis = eigen?.(s) ?? {};
              return { ...basis, style: { ...basis.style, ...kopfStilGefiltert } };
            };
          }
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
    [
      gezeigteSpalten,
      aktiveSortierung,
      karte,
      token.controlHeight,
      filterWerte,
      filterZaehlung,
      kopfStilGefiltert,
    ],
  );

  /**
   * Mit `aufklappen` trägt die KENNUNGSZELLE den Auslöser, keine eigene Aufklappspalte: hinter der
   * fixierten Kennung glitt eine solche Spalte bei 390 px unter sie (Gate 1), an Position 0 erbte
   * sie deren `fixed`. Die Kennungszelle ist immer sichtbar, wie in der Karte.
   *
   * Mit `baum` zeichnet die erste Spalte Einzug und Aufklappsymbol SELBST, als Flex-Zeile vor
   * einem Textblock (LFH-977, hängender Einzug). antd setzt beides als Floats vor den Inhalt
   * (Einzug 1 px hoch): ein langer Name brach darunter an den Zellrand um, ein zu breiter
   * Titel-Link (`inline-flex`, atomar) rutschte ganz darunter, das Fahrzeug stand links von
   * seiner Einheit und das Symbol allein darüber. Eine Block-Hülle neben den Floats genügt nicht:
   * Floats zählen nicht zur Mindestbreite der Zelle, im Druck des Meldebilds (Spalte ohne Breite)
   * blieben der Hülle ~12 px. Die Flex-Zeile trägt Einzug und Symbol in ihrer Mindestbreite.
   * Breitere Spalten heilten nur das Symptom. Symbol und Platzhalter behalten antds Klassen; das
   * Symbol steht seit LLH-1240 in einem Knopf mit dem Boden der Staffel (`baumSymbolZielStil`),
   * dessen Klick die Weitergabe an den Zeilen-Riegel stoppt.
   */
  const ersteSpalte = gezeigteSpalten[0];
  const baumTiefe = useMemo(() => {
    const tiefe = new Map<Key, number>();
    if (!baum) return tiefe;
    const gehe = (zeilen: readonly T[], t: number) => {
      for (const z of zeilen) {
        tiefe.set(schluessel(z), t);
        gehe((z[baum.kinder] as readonly T[] | undefined) ?? [], t + 1);
      }
    };
    gehe(sichtbareZeilen, 0);
    return tiefe;
  }, [baum, sichtbareZeilen, schluessel]);
  // Für die Garnitur nach INHALT: ohne Umhängen bleibt die Tiefe jeder Zeile gleich, die Map aber
  // ist nach jedem Datenstand neu.
  const baumTiefenStand = useMemo(
    () => [...baumTiefe].map(([k, t]) => `${String(k)}:${t}`).join('|'),
    [baumTiefe],
  );
  const hatBaumKinder = (zeile: T): boolean =>
    ((zeile[baum!.kinder] as readonly T[] | undefined)?.length ?? 0) > 0;
  const baumSymbol = (zeile: T): ReactNode => {
    const klasse = `${tabellenPraefix}-row-expand-icon`;
    const ziel = baumSymbolZielStil(token);
    // Blatt: antds unsichtbarer Platzhalter in der Breite des Knopfs, damit Geschwister bündig
    // stehen. Ohne Höhe: ein Blatt hat nichts zu treffen.
    if (!hatBaumKinder(zeile)) {
      return (
        <span
          aria-hidden
          data-lfh="datensicht-baum-platz"
          style={{
            display: 'inline-flex',
            justifyContent: 'center',
            flex: ziel.flex,
            minWidth: ziel.minWidth,
          }}
        >
          <span className={`${klasse} ${klasse}-spaced`} />
        </span>
      );
    }
    const k = schluessel(zeile);
    const offen = baum!.aufgeklappt.includes(k);
    return (
      <button
        type="button"
        data-lfh="datensicht-baum-ziel"
        style={ziel}
        aria-label={
          offen
            ? (tabellenText?.collapse ?? 'Zeile reduzieren')
            : (tabellenText?.expand ?? 'Zeile erweitern')
        }
        aria-expanded={offen}
        onClick={(event) => {
          event.stopPropagation();
          baum!.onAufgeklappt(
            offen ? baum!.aufgeklappt.filter((x) => x !== k) : [...baum!.aufgeklappt, k],
          );
        }}
      >
        {/* Das Symbol selbst bleibt antds, mit Klassen und Zeichnung; `float` hebt der Knopf
            als Flex-Hülle auf. */}
        <span aria-hidden className={`${klasse} ${klasse}-${offen ? 'expanded' : 'collapsed'}`} />
      </button>
    );
  };
  const ersteZelle = (wert: unknown, zeile: T, index: number): ReactNode => {
    const basis = antdSpalten[0].render;
    // Der Titel-Link ersetzt das Spalten-`render`; sonst die Zelle über `zelle`.
    return basis && basis !== ersteSpalte.render
      ? (basis(wert, zeile, index) as ReactNode)
      : zelle(ersteSpalte, zeile, index);
  };
  const ausloeserNeben = abBreite('xl');
  const tabellenSpalten: KatalogSpalte<T>[] =
    aufklappen && antdSpalten.length > 0 && ersteSpalte
      ? [
          {
            ...antdSpalten[0],
            // NEBENEINANDER AB xl, DARUNTER GESTAPELT (LFH-975): ab 1200 px steht der Auslöser in
            // derselben Zeile wie die Kennung und bricht erst um, wenn der Platz fehlt. Gestapelt
            // verdoppelte er dort die Zeilenhöhe (rund 71 px bei 1440), und nur die Hälfte der Kräfte
            // passte auf einen Schirm. Darunter bleibt er gestapelt: die automatische
            // Tabellenbreite rechnet Kennung UND Auslöser in die Wunschbreite der ersten Spalte, und
            // am Handy und Tablet schob das die Zahlspalten aus dem Bild (`betreuung-stellen-schmal`).
            // Der Ort bleibt die Kennungszelle (LFH-676, keine eigene Spalte); die Höhe des Knopfs
            // folgt weiter der Dichte, die Trefffläche bleibt also.
            render: (wert: unknown, zeile: T, index: number) => (
              <div
                data-lfh="datensicht-aufklapp-zelle"
                style={
                  ausloeserNeben
                    ? {
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        columnGap: token.marginXS,
                        rowGap: token.marginXXS,
                      }
                    : {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: token.marginXXS,
                      }
                }
              >
                {ersteZelle(wert, zeile, index)}
                {aufklappAusloeser(zeile, false)}
              </div>
            ),
          },
          ...antdSpalten.slice(1),
        ]
      : baum && antdSpalten.length > 0 && ersteSpalte
        ? [
            {
              ...antdSpalten[0],
              render: (wert: unknown, zeile: T, index: number) => (
                <div
                  data-lfh="datensicht-baum-zelle"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: token.paddingXS,
                    paddingInlineStart: (baumTiefe.get(schluessel(zeile)) ?? 0) * baumEinzug,
                  }}
                >
                  {baumSymbol(zeile)}
                  <div
                    data-lfh="datensicht-baum-text"
                    style={baumTextStil(token, hatBaumKinder(zeile))}
                  >
                    {/* Eine Hülle im normalen Fluss: als Flex-Kinder bräche Inline-Inhalt
                        (Text, Link, Marke) in getrennte Zeilen. */}
                    <div>{ersteZelle(wert, zeile, index)}</div>
                  </div>
                </div>
              ),
            },
            ...antdSpalten.slice(1),
          ]
        : antdSpalten;

  /**
   * Der Zeilenfehler steht in der KENNUNGSZELLE unter ihrem Inhalt: sie ist immer sichtbar (wie
   * der Aufklapp-Auslöser), eine eigene Spalte oder Zeile gäbe es nur für den seltenen Fehlerfall.
   * Ohne Grund bleibt die Zelle unverändert, ohne Hülle.
   */
  const fehlerJeZeile = (zeile: T): ZeilenGrund | null => zeilenFehler?.(zeile) ?? null;
  const spaltenMitFehler: KatalogSpalte<T>[] =
    zeilenFehler && tabellenSpalten.length > 0 && ersteSpalte
      ? [
          {
            ...tabellenSpalten[0],
            render: (wert: unknown, zeile: T, index: number) => {
              const basis = tabellenSpalten[0].render;
              const inhalt = basis
                ? (basis(wert, zeile, index) as ReactNode)
                : zelle(ersteSpalte, zeile, index);
              const grund = fehlerJeZeile(zeile);
              if (!grund) return inhalt;
              return (
                <div
                  data-lfh="datensicht-fehler-zelle"
                  style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}
                >
                  <div>{inhalt}</div>
                  {/* Breite 0, Mindestbreite 100 %: die Tabelle legt ihre Spalten automatisch aus,
                      ein langer Grund verbreiterte sonst die Kennungsspalte. So bricht er um und
                      zählt nicht zur Spaltenbreite. */}
                  <div style={{ width: 0, minWidth: '100%' }}>
                    <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />
                  </div>
                </div>
              );
            },
          },
          ...tabellenSpalten.slice(1),
        ]
      : tabellenSpalten;
  /**
   * Die zuletzt GEZEIGTEN Gründe je Zeile (nach dem Commit gesetzt, wie `useGarnitur`): die
   * Kennungszelle rendert neu, wenn ihr Grund ein anderes Objekt ist, sonst bliebe ein neuer Grund
   * hinter `shouldCellUpdate` unsichtbar. Gemerkt werden nur die Zeilen der obersten Ebene; das
   * genügt, weil `zeilenFehler` und `baum` sich ausschließen (`pruefeKartenplan`): an einem
   * Baumkind verschwände ein geräumter Grund nicht.
   */
  const gezeigteFehler = useRef<ReadonlyMap<Key, ZeilenGrund>>(new Map());
  useLayoutEffect(() => {
    if (!zeilenFehler) return;
    const stand = new Map<Key, ZeilenGrund>();
    for (const zeile of daten) {
      const grund = zeilenFehler(zeile);
      if (grund) stand.set(schluessel(zeile), grund);
    }
    gezeigteFehler.current = stand;
  });
  const fehlerNeu = (zeile: T) =>
    zeilenFehler != null &&
    fehlerJeZeile(zeile) !== (gezeigteFehler.current.get(schluessel(zeile)) ?? null);

  /**
   * Eine Zelle rendert nur bei geändertem Datensatz oder neuer Garnitur (D4). antd ruft sonst bei
   * jedem Render jedes `render` aller Zeilen; ein Live-Ereignis mit einer Person kostete die ganze
   * Liste. Ein Verwender, der `shouldCellUpdate` selbst setzt, behält seinen.
   */
  const tabellenGarnitur = useGarnitur([
    viertelstunde(),
    antdSpalten,
    aufklappen,
    aufgeklappt,
    baum,
    baumTiefenStand,
    ausloeserNeben,
    token,
    tabellenPraefix,
    tabellenText,
    schluessel,
  ]);
  const garniturNeu = tabellenGarnitur.neu;
  // Je Render neu gebaut wie `tabellenSpalten`: ein neues Spaltenobjekt rendert keine Zelle, das
  // entscheidet allein `shouldCellUpdate`. Ein offenes Kopfmenü verliert dadurch seinen Entwurf
  // nicht: `KatalogTabelle` hält die Spalten, solange es offen ist (LLH-1427).
  // Die erste Spalte trägt den Zeilenfehler: auch ein eigenes `shouldCellUpdate` lässt dort einen
  // neuen oder geräumten Grund durch.
  const gemerkteSpalten = spaltenMitFehler.map((s, i): KatalogSpalte<T> => {
    const eigen = s.shouldCellUpdate;
    if (eigen) {
      return i === 0 && zeilenFehler
        ? { ...s, shouldCellUpdate: (zeile, vorher) => eigen(zeile, vorher) || fehlerNeu(zeile) }
        : s;
    }
    return {
      ...s,
      shouldCellUpdate: (zeile, vorher) =>
        zeile !== vorher || garniturNeu || (i === 0 && fehlerNeu(zeile)),
    };
  });

  const { von: fensterVon, bis: fensterBis } = ausschnitt;
  const tabellenZeilen = useMemo(
    () => (virtuell ? sichtbareZeilen.slice(fensterVon, fensterBis) : [...sichtbareZeilen]),
    [virtuell, sichtbareZeilen, fensterVon, fensterBis],
  );
  // Zeilennummern nur in der flachen Tabelle: Baumkinder und Aufklappbereiche sind eigene `tr`.
  const zeilenNummern = virtuell && !baum && !aufklappen;
  const fensterTraeger = useMemo<FensterTraeger | null>(
    () =>
      virtuell
        ? {
            oben: ausschnitt.oben,
            unten: ausschnitt.unten,
            spaltenZahl: Math.max(1, tabellenSpalten.length),
            zeilenZahl: zeilenNummern ? sichtbareZeilen.length : null,
            setzeStart: setzeFensterStart,
          }
        : null,
    [
      virtuell,
      ausschnitt.oben,
      ausschnitt.unten,
      tabellenSpalten.length,
      zeilenNummern,
      sichtbareZeilen.length,
      setzeFensterStart,
    ],
  );
  const zeilenKlick = onZeileKlick
    ? (zeile: T): HTMLAttributes<HTMLElement> => ({
        onClick: (event) => {
          // Ein Portal (Auswahlliste eines Selects in der Zeile) reicht seinen Klick an die Zeile
          // weiter, liegt im DOM aber woanders: er gehört nicht der Zeile (wie im Baum unten).
          if (!event.currentTarget.contains(event.target as Node)) return;
          // Eigene Bedienziele der Zeile bedienen den Klick allein (LLH-1050: sonst öffnete ein
          // Zeilenknopf seinen Dialog UND die Zeile spränge auf ihr Ziel).
          if ((event.target as HTMLElement).closest(ZEILEN_BEDIENZIEL)) return;
          onZeileKlick(zeile);
        },
      })
    : baum
      ? (zeile: T): HTMLAttributes<HTMLElement> => ({
          /**
           * Derselbe Riegel für den Baum (LFH-548): die ganze Zeile klappt auf, außer der
           * Klick galt einem Bedienziel der Zeile oder kam aus einem Portal. antds
           * `expandRowByClick` kennt keinen Riegel: ein Klick auf den Titel-Link klappte
           * sonst mit um, beim Strg-Klick sogar in der Seite, die stehen bleibt; ein
           * Statusknopf klappte die Einheit zu, während sein Menü aufging. Das
           * Aufklappsymbol selbst stoppt die Weitergabe (`baumSymbol`, im Test gepinnt).
           */
          onClick: (event) => {
            const ziel = event.target as HTMLElement;
            // Ein React-Portal (Menü eines Zeilenknopfs) reicht seinen Klick an die Zeile
            // weiter, liegt im DOM aber woanders: er gehört nicht der Zeile.
            if (!event.currentTarget.contains(ziel)) return;
            // Eigene Bedienziele in der Zeile (Link, Knopf, Feld) bedienen den Klick allein.
            if (ziel.closest(ZEILEN_BEDIENZIEL)) return;
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
      : undefined;
  // Messpunkte des Ausschnitts: nur Zeilen der obersten Ebene, Baumkinder zählen zu ihrem Knoten.
  const zeilenImFenster = virtuell
    ? (zeile: T): HTMLAttributes<HTMLElement> => {
        const i = indexVon.get(schluessel(zeile));
        if (i == null) return {};
        return {
          ...fensterAttribute(zeile),
          ...(zeilenNummern ? { 'aria-rowindex': i + 1 } : {}),
        };
      }
    : undefined;

  const tabelle = (
    <GezeigteSpaltenKontext.Provider value={gezeigteSpaltenSchluessel}>
      <FensterKontext.Provider value={fensterTraeger}>
        <KatalogTabelle<T>
          columns={gemerkteSpalten}
          dataSource={tabellenZeilen}
          components={virtuell ? FENSTER_KOMPONENTEN : undefined}
          rowKey={(zeile) => schluessel(zeile)}
          loading={ladend}
          locale={leerInhalt != null ? { emptyText: leerInhalt } : undefined}
          // Keine Suche und keine Blätterung von `KatalogTabelle`: die Suche steht in der Werkzeugzeile,
          // eine Seitenblätterung schnitte die Zeilenschleuse entzwei. Große Listen schneidet der
          // Ausschnitt oben (LFH-949).
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
            zeilenKlick || zeilenImFenster
              ? (zeile) => ({ ...zeilenImFenster?.(zeile), ...zeilenKlick?.(zeile) })
              : undefined
          }
          /**
           * Sortieren ist hier der EINZIGE Auslöser von `onChange`, also darf es die Sortierung auch
           * LÖSCHEN: antds Zyklus endet mit `columnKey === undefined`, und ein früher Rücksprung darauf
           * ließe die Tabelle für immer absteigend.
           */
          onChange={(_seite, filter, sorter, extra) => {
            /**
             * Kopffilter (LLH-1086): antd meldet die Wahl aller Spalten; übernommen werden nur
             * Spalten mit eigenem `filter`. Eine Filteränderung meldet auch den (unveränderten)
             * Sortierzustand mit, deshalb entscheidet `action`.
             */
            if (extra?.action === 'filter') {
              for (const spalte of gezeigteSpalten) {
                if (!spalte.filter) continue;
                const neu = (filter[spalte.key] ?? []).map(String);
                const alt = filterWerte[spalte.key] ?? [];
                if (neu.length !== alt.length || neu.some((w, i) => w !== alt[i])) {
                  setzeFilter(spalte.key, neu);
                }
              }
              return;
            }
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
                  // Einzug und Symbol zeichnet die erste Spalte selbst (LFH-977, `tabellenSpalten`).
                  indentSize: 0,
                  expandIcon: () => null,
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
      </FensterKontext.Provider>
    </GezeigteSpaltenKontext.Provider>
  );

  // ── Kartenzweig ───────────────────────────────────────────────────────────────────
  const kartenEintrag = (zeile: T, index: number, tiefe: number): ReactNode => {
    const grund = fehlerJeZeile(zeile);
    const fehlerZeile = grund && <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />;
    if (karte.art === 'eigen') {
      const eigen = karte.render({ zeile, index, tiefe });
      return fehlerZeile ? (
        <>
          {eigen}
          {fehlerZeile}
        </>
      ) : (
        eigen
      );
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
          okText={aktion!.bestaetigungKnopf ?? aktion!.etikett}
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
          onOffenAenderung={(offen) => reportKartenMenue(schluessel(zeile), offen)}
        />
      ) : null;
    const aktionen = [knopf, menueKnopf].filter((k) => k != null);

    return (
      <div
        data-lfh="datensicht-karte"
        className={zeilenKlasse?.(zeile)}
        style={{ paddingInlineStart: token.padding * Math.min(tiefe, TIEFE_DECKEL) }}
      >
        <ListenEintrag
          actions={aktionen.length > 0 ? aktionen : undefined}
          gestapelt={karte.gestapelt}
          // Gestapelt stünde die Aktionszeile mit `paddingXS` (5 / 7 px) unter dem letzten Ziel des
          // Inhalts; die Leitlinie verlangt ≥ 8 / ≥ 16 px (Prüfliste LLH-1093, Kriterium 2).
          style={karte.gestapelt ? { rowGap: token.padding } : undefined}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                // Titel-Link und Statusauslöser sind zwei Ziele nebeneinander: Zielabstand aus
                // Kriterium 2 (`zielEinzug`, komfortabel ≥ 8, handschuh ≥ 16, LLH-1060). Gemessen
                // in `e2e/datensicht-schmal.spec.ts`, „Trefflächen des Primitivs …“.
                gap:
                  ziel != null && statusBedienung
                    ? token.marginXS + 2 * zielEinzug(token)
                    : token.marginXS,
                flexWrap: 'wrap',
              }}
            >
              {ziel != null ? (
                // Das Tastaturziel der Zeile: ein echter Link mit Höhe aus `controlHeight`.
                <Link to={ziel} style={{ ...kennungsLinkStil(token), fontWeight: 600 }}>
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
              <div style={kartenFelderStil(token)}>
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
            {fehlerZeile}
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

  const kartenGarnitur = useGarnitur([
    viertelstunde(),
    karte,
    spalten,
    token,
    aufklappen,
    schluessel,
    idPraefix,
  ]);
  const karteGemerkt = (zeile: T, index: number, tiefe: number): ReactNode => (
    <GemerkteKarte
      zeile={zeile}
      index={index}
      tiefe={tiefe}
      offen={aufklappen != null && aufgeklappt.includes(schluessel(zeile))}
      klasse={zeilenKlasse?.(zeile)}
      fehler={fehlerJeZeile(zeile)}
      garnitur={kartenGarnitur.nummer}
      zeichne={() => kartenEintrag(zeile, index, tiefe)}
    />
  );

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
        {karteGemerkt(zeile, index, tiefe)}
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

  /** `indexAb`: Lage der ersten Karte in ihrer Liste, wenn der Ausschnitt vorn abschneidet. */
  const kartenListe = (zeilenMenge: readonly T[], kopf?: ListenKopf, indexAb = 0) => (
    <Liste
      dataSource={zeilenMenge}
      rowKey={(zeile) => schluessel(zeile)}
      kopf={kopf}
      loading={ladend}
      // `emptyText` statt eines eigenen Leerzustands-Knotens.
      emptyText={leerInhalt}
      renderItem={(zeile, index) => {
        const eintrag = baum
          ? baumEintrag(zeile, indexAb + index, 0)
          : karteGemerkt(zeile, indexAb + index, 0);
        // Messpunkt des Ausschnitts; eine eigene Hülle, weil `karte.art === 'eigen'` frei rendert.
        return virtuell ? <div {...fensterAttribute(zeile)}>{eintrag}</div> : eintrag;
      }}
    />
  );

  /**
   * Gruppiert schneidet der Ausschnitt quer durch die Gruppen: gerendert werden nur Gruppen mit
   * Karten im Ausschnitt, ihr Kopf zählt weiter die ganze Gruppe.
   */
  const gruppenImFenster = () => {
    let lauf = 0;
    return gruppenKarten.map((g) => {
      const ab = lauf;
      lauf += g.zeilen.length;
      const teilVon = virtuell ? Math.max(0, fensterVon - ab) : 0;
      const teilBis = virtuell ? Math.min(g.zeilen.length, fensterBis - ab) : g.zeilen.length;
      if (teilVon >= teilBis) return null;
      return (
        <div key={g.wert}>
          {kartenListe(
            virtuell ? g.zeilen.slice(teilVon, teilBis) : g.zeilen,
            {
              inhalt: <Typography.Text strong>{gruppenZahl(g)}</Typography.Text>,
              unterEbene: gruppen!.unterEbene,
            },
            teilVon,
          )}
        </div>
      );
    });
  };

  const kartenListen =
    gruppen && !baum ? (
      <>
        {gruppenImFenster()}
        {gruppenKarten.length === 0 && kartenListe([])}
      </>
    ) : virtuell ? (
      kartenListe(folge.slice(fensterVon, fensterBis), undefined, fensterVon)
    ) : (
      kartenListe(sichtbareZeilen)
    );
  const kartenZweig = virtuell ? (
    <>
      <div
        ref={setzeFensterStart}
        aria-hidden
        data-lfh="datensicht-platzhalter"
        style={{ height: ausschnitt.oben }}
      />
      {kartenListen}
      <div
        aria-hidden
        data-lfh="datensicht-platzhalter"
        {...{ [FENSTER_ENDE]: '' }}
        style={{ height: ausschnitt.unten }}
      />
    </>
  ) : (
    kartenListen
  );

  /**
   * Gründe, deren Zeile in `daten` steht, aber hinter Suche, Filter oder Sammelbanner verborgen ist
   * (LFH-1077): sonst schwiege die Sicht über eine Ablehnung, bis jemand den Filter löst. Sie
   * stehen über der Liste, je Zeile mit ihrer Kennung (Kartentitel, sonst erste Spalte).
   */
  const gezeigteSchluessel = useMemo(
    () => new Set(sichtbareZeilen.map(schluessel)),
    [sichtbareZeilen, schluessel],
  );
  const kennungsSpalte =
    (karte.art === 'plan' ? spalten.find((s) => s.key === karte.titel.spalte) : undefined) ??
    spalten[0];
  const verdeckteFehler = zeilenFehler
    ? daten.flatMap((zeile, index) => {
        const k = schluessel(zeile);
        if (gezeigteSchluessel.has(k)) return [];
        const grund = zeilenFehler(zeile);
        return grund ? [{ k, zeile, index, grund }] : [];
      })
    : [];
  const verdeckteFehlerBlock = verdeckteFehler.length > 0 && (
    <div
      data-lfh="datensicht-verdeckte-fehler"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginXXS,
        marginBlockEnd: token.marginXS,
      }}
    >
      {verdeckteFehler.map(({ k, zeile, index, grund }) => (
        <ZeilenFehler
          key={String(k)}
          fehler={grund.fehler}
          fallback={grund.fallback}
          kennung={kennungsSpalte ? zelle(kennungsSpalte, zeile, index) : String(k)}
        />
      ))}
    </div>
  );

  return (
    <section ref={wurzel} aria-label={bezeichnung} {...zuflussBereich}>
      {werkzeugzeile}
      {einschraenkungAktiv && baum == null && (
        // Hinweis und Chips stehen nur bei Einschränkung; sie erscheinen als Antwort auf die
        // eigene Wahl, nicht als Zufluss, und belegen sonst keinen Platz.
        <div
          data-lfh="datensicht-einschraenkung"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: token.marginXS,
            marginBlockEnd: token.marginXS,
          }}
        >
          <Filterhinweis
            treffer={imServermodus ? serverseitig?.zahlen?.treffer : zeilen.length}
            gesamt={imServermodus ? serverseitig?.zahlen?.gesamt : daten.length}
            merkmale={filterMerkmale(suchbegriff, filterListe)}
            onZuruecksetzen={filterZuruecksetzen}
            dinge={mehrzahl}
          />
          <FilterChips
            filter={filterListe}
            onEntfernen={(spalte, wert) =>
              setzeFilter(
                spalte,
                (filterWerte[spalte] ?? []).filter((w) => w !== wert),
              )
            }
          />
        </div>
      )}
      {verdeckteFehlerBlock}
      {/* GENAU EIN Zweig im Baum, kein Umschalten per verborgener Fläche. */}
      {alsTabelle ? tabelle : kartenZweig}
    </section>
  );
}
