import { ConfigProvider, Input, Table, type InputRef, type TableProps, type TableRef } from 'antd';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Key,
  type RefObject,
} from 'react';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';
import type { TastaturAktionen } from '../command-palette/typen';
import {
  hatWaehlbareSpalten,
  sichtbareSpalten,
  SpaltenSchalter,
  type SchaltbareSpalte,
} from './SpaltenSchalter';
import { useViewport, type AbBreitePunkt } from './useViewport';
import type { Farbrollen } from '../theme/tokens';
import { useRollen } from './instrument/rollenwerte';
import { useDruckModus } from './druck/useDruckModus';
import { useRahmenObenFuer } from './rahmenOben';
import { useFokusUnterKopf } from './fokusUnterKopf';
import Filterhinweis from './instrument/Filterhinweis';
import { aktiveFilter, FilterChips, filterMerkmale, kopfGefiltertStil } from './tabellenFilter';
import {
  GEDAECHTNIS_ENTPRELLUNG_MS,
  type ListenGedaechtnis,
  type ListenSortierung,
} from './listenGedaechtnis';
// Kopfzellen-Typografie und Mono-Spalten liegen als Klassen in der Gestaltungssprache
// (`.lfh-katalog …`). Der Import gehört HIERHER: nicht jeder Konsument montiert `EinsatzSeite`.
import '../theme/sprache.css';

/**
 * Geteiltes Tabellen-Primitiv der Katalog-/Verwaltungsseiten (LFH-329 · B1): Gate 2 der
 * Bedien-Leitlinie an EINER Stelle. Drei Merkmale setzt das Primitiv unbedingt:
 *
 * 1. **Waagerechter Scrollcontainer über die Spaltenbreite.** Auf schmalem Schirm wird die
 *    Tabelle angepasst, nicht in Karten aufgelöst; sie scrollt in sich.
 * 2. **Stehende Kopfzeile.** antd zieht Kopf und Körper dafür in zwei `<table>` auseinander und
 *    schiebt eine verborgene Messzeile als erste Körperzeile ein; Tests verengen deshalb auf
 *    `tr.ant-table-row`.
 * 3. **Fixierte Identifierspalte.** Die erste Spalte bleibt stehen, und sie ist die
 *    MENSCHENLESBARE Kennung, nie die DB-Kennung (DEV-Warnung unten).
 *
 * Zeilenschlüssel, Ladezustand und Leertext setzt der Aufrufer; ihre VERSCHRÄNKUNG gehört hierher
 * (siehe unten).
 *
 * **Suche: opt-in.** Ohne `suche` gibt es weder Feld noch Werkzeugzeile (manche Seiten haben eine
 * eigene Suche, `Datensicht` bringt seine mit). Der Platzhalter nennt die durchsuchten Felder und
 * steht deshalb ganz im Feld ({@link suchfeldStil}, LFH-980). Gesucht wird über {@link zellenWert}, also nur in
 * Spalten mit auflösbarem Datenbezug; render-only-Spalten tragen NICHT bei, außer mit einem
 * {@link KatalogSpalte.suchText}-Haken (dieselbe Signatur wie `DatensichtSpalte.suchText`).
 * **`suchText` gewinnt**: trägt eine Spalte beides, wird nur der Haken bewertet, ein Haken kann
 * also auch verengen.
 *
 * **Blätterung ab {@link BLAETTER_SCHWELLE} Zeilen.** Gerechnet gegen `dataSource.length`, nicht
 * gegen die gefilterte Menge, sonst verschwände die Leiste beim Tippen (Kriterium 12). Ein
 * übergebenes `pagination` gewinnt (`??`, damit ein gesetztes `false` hält).
 *
 * **Spaltenschalter: opt-in** (Kriterium 14).
 * · Mit `spaltenSchalter` steht er in der Werkzeugzeile; Zählung und Menü aus
 *   `SpaltenSchalter.tsx`, derselben Quelle wie in `Datensicht`.
 * · Ohne Opt-in bleiben alle Spalten sichtbar: `abBreite` wirkt nicht (DEV-Meldung), antds
 *   `responsive`/`hidden` sind am Typ und per Guard gesperrt.
 * · `Datensicht` setzt das Prop NIE, es rendert seinen eigenen Schalter.
 * · Eine Spalte, die immer im Bild stehen muss (Status, Aktionen), trägt `immerSichtbar` und
 *   `fixed: 'right'` (LFH-980); die Fixierung der ersten Spalte bleibt davon unberührt.
 * · Was man nicht sieht, wirkt nicht: antd hält Filter- und Sortierzustand nur für übergebene
 *   Spalten, eine ausgeblendete gefilterte Spalte siebt nicht (gepinnt in
 *   `OnlineQuellenVerwaltung.test.tsx`).
 *
 * **Kopfwerkzeuge folgen der Dichte** (LLH-1227, Kriterium 2). Die Werkzeugzeile hält zwischen
 * Suche und Spaltenschalter `paddingSM` (7 / 11 / 16 px, {@link werkzeugAbstand}). antds
 * Spaltenfilter-Auslöser ist ein `span` mit `tabIndex=-1` in Schriftgröße (20 × 23 px in jeder
 * Stufe): er bekommt den Boden `controlHeightSM` über {@link filterKopfStil} und `sprache.css`,
 * und {@link useFilterTastatur} nimmt ihn in die Tab-Folge (Enter/Leertaste öffnen, Escape
 * schließt und gibt den Fokus zurück, das trägt antds Dropdown).
 *
 * **Sortieren und Filtern wie in `Datensicht`** (LLH-1086, Spec `tabellen-sortieren-filtern`).
 * Filter- und Sortierzustand einer Spalte mit `filters` bzw. `sorter` liegen KONTROLLIERT hier
 * (vorbelegt aus `defaultFilteredValue`/`defaultSortOrder` oder aus `gedaechtnis`); antd zeichnet
 * Trichter, Menü und Pfeil und filtert über das `onFilter` der Spalte; im Menü trägt jeder Wert
 * seinen Zähler („Aktiv (3)“, LLH-1096), solange alle wirkenden Filter ein `onFilter` haben. Bei
 * Suche oder Filter steht der `Filterhinweis` (Treffer von Gesamt) samt Chips je Wert, „Filter
 * zurücksetzen“ leert beides.
 * Was man nicht sieht, wirkt nicht und steht nicht als Chip da. Eine Spalte mit EIGENEM
 * `filteredValue`/`sortOrder` bleibt beim Aufrufer — so `Datensicht`, die Hinweis und Chips selbst
 * zeigt. `onChange` des Aufrufers hört weiter mit. Solange ein Filtermenü offen ist, bekommt antd
 * die Spaltenliste vom Öffnen, damit der angehakte Entwurf einen Neuaufbau übersteht (LLH-1427,
 * „EIN OFFENES FILTERMENÜ BEHÄLT SEINEN ENTWURF“ unten).
 *
 * ── DREI ZUSTÄNDE, DIE LADEUNTERDRÜCKUNG LEBT HIER ──
 *
 * **ladend**, **leer** und **gefüllt**; **Fehler** tauscht die Seite gegen `SeitenFehler`, bevor
 * die Tabelle montiert (ein `fehler`-Prop wirkte im Kartenzweig von `Datensicht` nicht).
 *
 * **Ladend und leer schließen sich aus, entschieden an EINER Stelle: hier.** Solange geladen
 * wird, wird der Leertext unterdrückt (`locale.emptyText` auf `null`), wie in `Liste.tsx`. Sonst
 * behauptete jede Seite beim ersten Rendern „Noch keine …“. Deshalb fallen `loading` und `locale`
 * NICHT durch `...rest` an antd. (Bei ganz fehlender `dataSource` unterdrückt antd selbst; diese
 * Stelle deckt `[]`.)
 *
 * · `loading` ist `boolean | SpinProps`; ein OBJEKT ohne `spinning` lädt ebenfalls.
 * · `emptyText: null` unterdrückt wirklich (antd prüft `typeof … !== 'undefined'`); gemessenes
 *   Verhalten, deshalb als Pin in `KatalogTabelle.test.tsx`.
 */
export type KatalogSpalte<T> = OhneAntdAusblendung<
  NonNullable<TableProps<T>['columns']>[number]
> & {
  /**
   * Beitrag dieser Spalte zur Freitextsuche, gleiche Signatur und gleicher Name wie
   * `DatensichtSpalte.suchText`. Fehlt er, gilt der Rohwert über den `dataIndex`-Pfad; ist er da,
   * gewinnt er allein.
   *
   * Das Feld fällt mit an `<Table>` durch, landet aber in keinem DOM-Attribut:
   * `@rc-component/table` reicht an eine Zelle nur die Rückgabe von `onCell`/`onHeaderCell` durch.
   */
  suchText?: (zeile: T) => string | null | undefined;
  /**
   * Diese Spalte FLIESST: sie nimmt den Rest der Sichtbreite und bricht um, statt die Tabelle zu
   * verbreitern. Wert ist ihr Mindestmaß in px (LFH-523). Gegenstück zu antds `width` (eine Spalte
   * trägt das eine ODER das andere). OPT-IN; ohne Haken bleibt jede Tabelle inhaltsgetrieben. Siehe
   * {@link fliessBreite}.
   */
  mindestBreite?: number;
  /**
   * Zahlen-, Zeit- oder Kennungsspalte: Zellen in Mono mit `tabular-nums`, als Klasse
   * `lfh-zahl-spalte` an Kopf- und Datenzelle (Schrift in `sprache.css`).
   */
  zahl?: boolean;
  /**
   * Klartext für den Spaltenschalter, wenn `title` kein String ist; gleicher Name wie an
   * `DatensichtSpalte`.
   */
  etikett?: string;
  /** Im Spaltenschalter nicht abwählbar (Aktionsspalte). Spalte 0 ist es immer. */
  immerSichtbar?: boolean;
  /**
   * Erst ab dieser Breite sichtbar; darunter fällt die Spalte weg und der Schalter zählt sie mit.
   * Wirkt NUR mit `spaltenSchalter`, sonst wäre es eine stille Ausblendung (Kriterium 14); ohne
   * Opt-in meldet es sich in DEV.
   */
  abBreite?: AbBreitePunkt;
};

/**
 * antds Ausblendwege (`responsive`, `hidden`) sind gesperrt: sie verbärgen Spalten, die der
 * Spaltenzähler nicht kennt. DISTRIBUTIV, weil antds Spaltentyp eine Union aus Blattspalte und
 * Gruppe ist. Die Sperre greift an Objektliteralen; für annotierte `TableColumnsType<T>`-Listen
 * hält der Guard in `katalogTabelle.guard.test.ts` die Felder fern.
 */
type OhneAntdAusblendung<C> = C extends unknown ? Omit<C, 'responsive' | 'hidden'> : never;

/**
 * Die Tabellen-Tokens, rein und exportiert (jsdom rechnet kein CSS-in-JS).
 *
 * Kopfzeile auf `kopf`, Kopftext `gedaempft` (9,62 Tag · 7,48 Nacht; `schwach` lag am Tag bei
 * 5,58, LFH-652), keine senkrechten Trenner im Kopf. Zeilentrenner als
 * Haarlinie: nachts `flaeche2`, am Tag `flaeche3` (`flaeche2` läge dort bei 1,08 : 1 auf Weiß).
 * Hover auf `flaeche3` aus demselben Grund; Link und Beschreibungstext halten darauf den
 * Tagesboden (7,46 / 8,62, LFH-702). Die Zellpolsterung folgt der Dichte-Staffel
 * (`paddingSM` / `padding`).
 */
export function tabellenTokens(
  rollen: Pick<Farbrollen, 'kopf' | 'gedaempft' | 'flaeche2' | 'flaeche3'>,
  dunkel: boolean,
  token: { paddingSM: number; padding: number },
) {
  return {
    headerBg: rollen.kopf,
    headerColor: rollen.gedaempft,
    headerSplitColor: 'transparent',
    headerSortActiveBg: rollen.kopf,
    headerSortHoverBg: rollen.flaeche3,
    fixedHeaderSortActiveBg: rollen.kopf,
    headerBorderRadius: 0,
    borderColor: dunkel ? rollen.flaeche2 : rollen.flaeche3,
    rowHoverBg: rollen.flaeche3,
    cellPaddingBlock: token.paddingSM,
    cellPaddingInline: token.padding,
  };
}

export type KatalogTabelleProps<T> = Omit<
  TableProps<T>,
  'scroll' | 'sticky' | 'columns' | 'tableLayout'
> & {
  /**
   * Wie antds `columns`, je Spalte um {@link KatalogSpalte.suchText} erweitert (optional, damit
   * annotierte `TableColumnsType<T>`-Listen zuweisbar bleiben).
   */
  columns?: KatalogSpalte<T>[];
  /**
   * Schaltet Werkzeugzeile und Freitextsuche ein. Gesucht wird in Spalten mit auflösbarem
   * `dataIndex` oder mit `suchText` (siehe Dateikopf).
   */
  suche?: { platzhalter: string };
  /**
   * Schaltet den Spaltenschalter mit Zähler ein (Kriterium 14). OPT-IN: ohne dieses Prop bleibt
   * jede Spalte sichtbar und `abBreite` wirkungslos. `bezeichnung` steht im zugänglichen Namen des
   * Knopfs, damit zwei Schalter unterscheidbar bleiben. `Datensicht` setzt es NIE.
   */
  spaltenSchalter?: { bezeichnung: string };
  /**
   * Gedächtnis der Tabelle (LLH-1086, `components/listenGedaechtnis.ts`): Sortierung, Filter, Suche
   * und Spaltenwahl beginnen beim gemerkten Stand und gehen entprellt zurück. `Datensicht` setzt es
   * NIE, sie trägt ihr eigenes.
   */
  gedaechtnis?: ListenGedaechtnis;
  /** Mehrzahl im Dativ für den `Filterhinweis` („3 von 9 Quellen sichtbar“); Vorgabe „Einträgen“. */
  mehrzahl?: string;
};

/**
 * Breite der fixierten Kennungsspalte unter `md`, wenn rechts Status und Aktionen fixiert stehen
 * (LFH-980, Bauform der Benutzerliste aus LFH-819). rc-table schiebt fixierte Spalten, die
 * zusammen breiter als die Sicht sind, übereinander: eine lange Kennung läge in 390 px über dem
 * Status. Mit dieser Zahl bricht die Kennung um (`overflowWrap: 'anywhere'` in der Zelle) und
 * bleibt ganz lesbar. Gegen die schmalste Fläche gewählt.
 */
export const KENNUNG_SCHMAL_BREITE = 136;

/** Höchstbreite des Platzhaltertexts im Suchfeld ab `md`, in px (LFH-980). */
export const SUCHFELD_TEXT_MAX = 360;

/**
 * Breite des Suchfelds, rein und exportiert (jsdom rechnet kein Layout; LFH-980).
 *
 * Der Platzhalter nennt, wonach gesucht werden kann („Funkrufname, Typ oder Kennzeichen“). Ein
 * fester Deckel kürzte ihn auf jedem Schirm, auch neben 900 px freier Zeile. Deshalb:
 * · unter `md` die volle Zeile;
 * · ab `md` so breit wie der Platzhalter, höchstens {@link SUCHFELD_TEXT_MAX} px Text, plus der
 *   Rahmen des Felds: Polster beidseits, das Löschzeichen und der quadratische Suchknopf, alle
 *   aus der Dichte-Staffel. `ch` ist die Breite der Ziffer 0 und liegt in der Textschrift über
 *   dem Mittel deutscher Kleinbuchstaben; die Schätzung ist eine Obergrenze, gemessen in
 *   `e2e/verwaltungstabellen-schmal.spec.ts`.
 */
export function suchfeldStil(
  platzhalter: string,
  schmal: boolean,
  token: { controlHeight: number; paddingSM: number; fontSize: number },
): CSSProperties {
  if (schmal) return { width: '100%' };
  const rahmen = 2 * token.paddingSM + token.fontSize + 8 + token.controlHeight + 2;
  return {
    width: `calc(min(${platzhalter.length}ch, ${SUCHFELD_TEXT_MAX}px) + ${rahmen}px)`,
    maxWidth: '100%',
  };
}

/**
 * Abstand zwischen den Werkzeugen über der Tabelle, rein und exportiert (LLH-1227). Die Leitlinie
 * verlangt zwischen zwei Zielen ≥ 8 px in `komfortabel` und ≥ 16 px in `handschuh`; `paddingXS`
 * lag bei 3 / 5 / 7 px, `paddingSM` hält 7 / 11 / 16 (`kompakt` hat die Spacing-Ausnahme).
 */
export function werkzeugAbstand(token: { paddingSM: number }): number {
  return token.paddingSM;
}

/**
 * Boden und Einzug des Spaltenfilter-Auslösers als Variablen an der Tabellenwurzel, rein und
 * exportiert (LLH-1227; gelesen in `theme/sprache.css`, Muster `ortspfadStil`). Der Boden ist
 * `controlHeightSM` (24 / 48 / 72); der Einzug ist die Kopfzellen-Polsterung (`paddingSM`, wie
 * `cellPaddingBlock` in {@link tabellenTokens}), um die der Auslöser in die Polsterung ragt,
 * damit der Kopf nicht um das Doppelte wächst.
 */
export function filterKopfStil(token: { controlHeightSM: number; paddingSM: number }) {
  return {
    '--lfh-filter-ziel': `${token.controlHeightSM}px`,
    '--lfh-filter-einzug': `${token.paddingSM}px`,
  } as CSSProperties;
}

/** antds Filter-Auslöser im Kopf; die Messzeile im Körper trägt eine stumme Kopie. */
const FILTER_AUSLOESER = 'thead .ant-table-filter-trigger';

/** Zugänglicher Name des Auslösers aus dem Spaltentitel, mit Zustand als Wort. */
function filterName(ausloeser: HTMLElement): string {
  const titel = ausloeser.closest('th')?.querySelector('.ant-table-column-title')?.textContent;
  const spalte = titel?.trim() ? `${titel.trim()} filtern` : 'Spalte filtern';
  return ausloeser.classList.contains('active') ? `${spalte}, gefiltert` : spalte;
}

/**
 * Nimmt antds Spaltenfilter-Auslöser in die Tab-Folge (LLH-1227). antd rendert ihn als
 * `span role="button" tabIndex={-1}` ohne Namen und ohne Tastenweg; ein eigener `filterIcon`
 * läge nur IN diesem `span` (verschachteltes Bedienziel). Deshalb am DOM: `tabIndex` 0, Name aus
 * dem Spaltentitel, Enter/Leertaste lösen den Klick aus, auf den antds Dropdown hört. Escape und
 * die Fokusrückgabe trägt das Dropdown selbst (`useAccessibility` in `@rc-component/dropdown`).
 *
 * Der Tastenhörer liegt an der Wurzel und hält das Ereignis an: sonst sortierte eine sortierbare
 * Kopfzelle beim selben Enter mit (ihr `onKeyDown` hört über Reacts Wurzel). Ein Beobachter hält
 * Neuaufbauten des Kopfs (Spaltenschalter, Filterzustand) nach; er hört nur auf `class`, die
 * eigenen Attribute lösen ihn nicht aus.
 */
export function useFilterTastatur(tabelle: RefObject<TableRef | null>): void {
  useEffect(() => {
    const wurzel = tabelle.current?.nativeElement;
    if (!wurzel) return;
    const erschliesse = () => {
      for (const ausloeser of wurzel.querySelectorAll<HTMLElement>(FILTER_AUSLOESER)) {
        if (ausloeser.tabIndex !== 0) ausloeser.tabIndex = 0;
        const name = filterName(ausloeser);
        if (ausloeser.getAttribute('aria-label') !== name)
          ausloeser.setAttribute('aria-label', name);
      }
    };
    const taste = (ereignis: KeyboardEvent) => {
      if (ereignis.key !== 'Enter' && ereignis.key !== ' ') return;
      const ziel = ereignis.target as HTMLElement | null;
      if (!ziel?.matches(FILTER_AUSLOESER)) return;
      ereignis.preventDefault();
      ereignis.stopPropagation();
      ziel.click();
    };
    erschliesse();
    const beobachter = new MutationObserver(erschliesse);
    beobachter.observe(wurzel, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    wurzel.addEventListener('keydown', taste);
    return () => {
      beobachter.disconnect();
      wurzel.removeEventListener('keydown', taste);
    };
  }, [tabelle]);
}

/** Ab dieser Zeilenzahl blättert das Primitiv von selbst. */
export const BLAETTER_SCHWELLE = 50;

type Spalte<T> = NonNullable<TableProps<T>['columns']>[number];

/**
 * Der bewertbare Schlüssel eines Spaltenbezugs; bei der Pfadform `['meta', 'id']` das letzte
 * Glied. NUR für die DEV-Warnung: als Suchresolver lieferte er `zeile['id']` statt
 * `zeile.meta.id`; dafür gibt es {@link zellenWert}.
 */
function bezugsSchluessel<T>(spalte: Spalte<T> | undefined): string | undefined {
  if (!spalte || 'children' in spalte || !('dataIndex' in spalte)) return undefined;
  const bezug = spalte.dataIndex;
  const glied = Array.isArray(bezug) ? bezug[bezug.length - 1] : bezug;
  return typeof glied === 'string' ? glied : undefined;
}

/**
 * Der durchsuchbare Rohwert einer Zelle, über den VOLLEN `dataIndex`-Pfad.
 * `undefined`, wenn die Spalte keinen auflösbaren Datenbezug hat (render-only, Gruppe).
 */
function zellenWert<T>(spalte: Spalte<T>, zeile: T): unknown {
  if ('children' in spalte || !('dataIndex' in spalte)) return undefined;
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
 * Das Ergebnis der Breitenrechnung: entweder eine Zahl (gedeckelt) oder das
 * inhaltsgetriebene `'max-content'` des Bestands, dann mit Grund.
 */
interface Fliessmass {
  /** Was als `scroll.x` an antd geht. */
  x: number | 'max-content';
  /** Gesetzt, wenn ein Opt-in vorlag, aber nicht trug. Wird in DEV gemeldet. */
  warnung?: string;
}

/**
 * Die Tabellenbreite aus den ÜBERGEBENEN Spalten (LFH-523), rein und exportiert.
 *
 * `scroll={{ x: 'max-content' }}` macht die Breite inhaltsgetrieben: eine Spalte ohne `width`
 * trägt ihre volle `max-content`-Breite bei, und ein umbrechbarer Langtext bleibt einzeilig und
 * läuft weit aus der Sicht. Trägt genau EINE Spalte {@link KatalogSpalte.mindestBreite}, ist die
 * Breite `Σ(width der übrigen) + mindestBreite`; antds `min-width: 100%` bleibt, die Tabelle
 * füllt weiter den Container und scrollt erst unterhalb dieser Zahl. Liegt die Zahl unter der
 * Containerbreite, verteilt die `auto`-Layoutrechnung identisch zur Vorgabe.
 *
 * Zwei Abbrüche, beide mit DEV-Warnung und Bestandsverhalten: eine Nachbarspalte ohne Zahlbreite
 * (auch `'20%'` oder eine Gruppe; ein geratener Deckel wäre schlechter als keiner) und zwei
 * Fließspalten (welche den Rest bekäme, entschiede das Layout). Ein Opt-in, das still nichts tut,
 * wäre von einem kaputten nicht zu unterscheiden.
 */
export function fliessBreite<T>(spalten: readonly KatalogSpalte<T>[] | undefined): Fliessmass {
  const fliessend = (spalten ?? []).filter((s) => s.mindestBreite != null);
  if (fliessend.length === 0) return { x: 'max-content' };
  if (fliessend.length > 1) {
    return {
      x: 'max-content',
      warnung:
        `Mehr als eine Fließspalte (${fliessend.map((s) => String(s.key)).join(', ')}) — ` +
        'die Tabellenbreite bleibt inhaltsgetrieben. Genau eine Spalte nimmt den Rest.',
    };
  }
  let summe = 0;
  for (const spalte of spalten ?? []) {
    if (spalte.mindestBreite != null) {
      summe += spalte.mindestBreite;
      continue;
    }
    if (typeof spalte.width !== 'number') {
      return {
        x: 'max-content',
        warnung:
          `Die Spalte „${String(spalte.key ?? spalte.title)}" hat keine Zahlbreite — neben ` +
          'einer Fließspalte ist die Tabellenbreite damit nicht ausrechenbar und bleibt ' +
          'inhaltsgetrieben.',
      };
    }
    summe += spalte.width;
  }
  return { x: summe };
}

/**
 * Ref-gezählte, modulweite `/`-Bindung. Zwei gleichzeitig montierte Tabellen (etwa Reiter ohne
 * `destroyOnHidden`) stritten sonst um den Fokus; bei mehr als einer Instanz tut das Kürzel
 * NICHTS und warnt in DEV.
 */
const suchFelder = new Set<() => void>();
let schonGewarnt = false;

function slashBehandeln(ereignis: KeyboardEvent): void {
  if (ereignis.key !== '/' || ereignis.metaKey || ereignis.ctrlKey || ereignis.altKey) return;
  const ziel = ereignis.target as HTMLElement | null;
  const marke = ziel?.tagName;
  if (marke === 'INPUT' || marke === 'TEXTAREA' || marke === 'SELECT' || ziel?.isContentEditable) {
    return;
  }
  if (suchFelder.size !== 1) {
    if (import.meta.env.DEV && suchFelder.size > 1 && !schonGewarnt) {
      schonGewarnt = true;
      console.warn(
        '[KatalogTabelle] Mehr als eine Tabelle mit Suchfeld ist montiert — das /-Kürzel ' +
          'bleibt deshalb wirkungslos. Wer zwei suchbare Tabellen auf einer Seite braucht, ' +
          'gibt der zweiten kein `suche`-Prop oder trennt die Reiter per destroyOnHidden.',
      );
    }
    return;
  }
  ereignis.preventDefault();
  for (const fokussiere of suchFelder) fokussiere();
}

function useSlashKuerzel(aktiv: boolean, fokussiere: () => void): void {
  // Der Ref hält die frische Fokusfunktion, damit der Effekt an `aktiv` allein hängt; sonst meldete
  // er den Zuhörer bei jedem Render ab und an, und die Zählung flackerte.
  const merker = useRef(fokussiere);
  merker.current = fokussiere;

  useEffect(() => {
    if (!aktiv) return;
    const eintrag = () => merker.current();
    if (suchFelder.size === 0) window.addEventListener('keydown', slashBehandeln);
    suchFelder.add(eintrag);
    return () => {
      suchFelder.delete(eintrag);
      if (suchFelder.size === 0) {
        window.removeEventListener('keydown', slashBehandeln);
        schonGewarnt = false;
      }
    };
  }, [aktiv]);
}

/**
 * CSS-Variable für den Freiraum unter der stehenden Kopfzeile; gelesen in `theme/sprache.css`
 * (`.lfh-katalog .ant-table-tbody *`).
 */
export const KOPF_FREIRAUM = '--lfh-tabellenkopf-hoehe';

/**
 * Schreibt die Höhe der stehenden Kopfzeile als {@link KOPF_FREIRAUM} an die Tabellenwurzel
 * (WCAG 2.4.11): rückwärts getabbt rollt der Browser das Ziel an den oberen Rand, genau unter die
 * Kopfzeile. `scroll-margin-top` am Ziel hält den Freiraum frei. Gemessen statt aus Tokens
 * gerechnet, weil die Kopfzeile umbrechen kann; ohne stehende Kopfzeile ist er 0.
 */
export function setzeKopfFreiraum(wurzel: HTMLElement): void {
  const kopf = wurzel.querySelector<HTMLElement>('.ant-table-sticky-holder');
  wurzel.style.setProperty(KOPF_FREIRAUM, `${kopf?.offsetHeight ?? 0}px`);
  // Dieselbe Messung für die fixierte Kennung, siehe `SPALTEN_FREIRAUM`.
  const kennung = wurzel.querySelector<HTMLElement>('th.ant-table-cell-fix-start');
  wurzel.style.setProperty(SPALTEN_FREIRAUM, `${kennung?.offsetWidth ?? 0}px`);
}

/**
 * CSS-Variable für den Freiraum NEBEN der fixierten Kennung; gelesen in `theme/sprache.css`
 * (`scroll-padding-inline-start` an Kopf- und Körpercontainer). Rückwärts getabbt richtet der
 * Browser eine Kopf- oder Zellenmarke am linken Rand des Scrollports aus, also unter der
 * Kennung, sobald die Tabelle waagerecht überläuft (LFH-967: eine breite Kennung mit
 * Meldeknopf bei 390 px verdeckte „belegt“ ganz). Dasselbe Mittel wie die Gefahrenmatrix
 * (`pages/gefahren/gefahrenMatrix.css`, LFH-373); gemessen, weil die Spalte mit Dichte und
 * Inhalt wächst.
 */
export const SPALTEN_FREIRAUM = '--lfh-tabellen-kennung-breite';

/**
 * Hält {@link KOPF_FREIRAUM} aktuell. Beobachtet wird die WURZEL: die Kopfzeile kann nach dem
 * ersten Bild entstehen oder ausgetauscht werden, und das ändert auch die Wurzel. Exportiert für
 * die Gefahrenmatrix (keine `KatalogTabelle`, aber dieselbe stehende Kopfzeile; ihren
 * `scroll-margin-top` bringt sie in `gefahrenMatrix.css` selbst mit).
 */
export function useKopfFreiraum(tabelle: RefObject<TableRef | null>): void {
  useEffect(() => {
    const wurzel = tabelle.current?.nativeElement;
    if (!wurzel) return;
    setzeKopfFreiraum(wurzel);
    const beobachter = new ResizeObserver(() => setzeKopfFreiraum(wurzel));
    beobachter.observe(wurzel);
    // Die Kennung wächst mit der Dichte, ohne dass sich die Wurzel ändern muss.
    const kennung = wurzel.querySelector('th.ant-table-cell-fix-start');
    if (kennung) beobachter.observe(kennung);
    return () => beobachter.disconnect();
  }, [tabelle]);
}

/**
 * Lädt die Tabelle gerade? Wie antds `useSpinProps`: ein Objekt ohne `spinning` lädt, ein
 * explizites `spinning: false` nicht.
 */
function istLadend(loading: TableProps['loading']): boolean {
  if (typeof loading === 'boolean') return loading;
  if (loading == null) return false;
  return loading.spinning ?? true;
}

/** Eine Schalterspalte mit Rückverweis auf ihre Position in der übergebenen Garnitur. */
type IndizierteSpalte = SchaltbareSpalte & { index: number };

/**
 * Übersetzt die Spalten in die Form, die {@link sichtbareSpalten} liest. Eine Spalte ohne
 * String-`key` bekommt bei Opt-in einen Ersatzschlüssel und gilt als `immerSichtbar` (gemeldet
 * wird sie trotzdem). Ohne Opt-in bleibt `abBreite` außen vor.
 */
function schaltbareFassung<T>(
  spalten: readonly KatalogSpalte<T>[],
  optIn: boolean,
): { schaltbar: IndizierteSpalte[]; ohneSchluessel: string[] } {
  const ohneSchluessel: string[] = [];
  const schaltbar = spalten.map((spalte, index): IndizierteSpalte => {
    const hatSchluessel = typeof spalte.key === 'string';
    if (!hatSchluessel && optIn && index !== 0 && !spalte.immerSichtbar) {
      const name =
        spalte.etikett ?? (typeof spalte.title === 'string' ? spalte.title : `#${index}`);
      ohneSchluessel.push(`„${name}"`);
    }
    return {
      key: hatSchluessel ? (spalte.key as string) : `__ohne-key-${index}`,
      etikett: spalte.etikett,
      title: spalte.title,
      immerSichtbar: spalte.immerSichtbar || !hatSchluessel,
      abBreite: optIn ? spalte.abBreite : undefined,
      index,
    };
  });
  return { schaltbar, ohneSchluessel };
}

/** Der Zustandsschlüssel einer Spalte: `key`, sonst ein einfacher `dataIndex` (wie antds Filter). */
function zustandsSchluessel<T>(spalte: KatalogSpalte<T>): string | undefined {
  if (typeof spalte.key === 'string') return spalte.key;
  if (!('children' in spalte) && 'dataIndex' in spalte && typeof spalte.dataIndex === 'string') {
    return spalte.dataIndex;
  }
  return undefined;
}

/** Filtert das Primitiv diese Spalte selbst (und nicht der Aufrufer über `filteredValue`)? */
function filterIntern<T>(spalte: KatalogSpalte<T>): boolean {
  return (
    !('children' in spalte) &&
    spalte.filters != null &&
    !('filteredValue' in spalte) &&
    zustandsSchluessel(spalte) != null
  );
}

/** Sortiert das Primitiv diese Spalte kontrolliert (und nicht der Aufrufer über `sortOrder`)? */
function sortierungIntern<T>(spalte: KatalogSpalte<T>): boolean {
  return (
    !('children' in spalte) &&
    spalte.sorter != null &&
    spalte.sorter !== false &&
    !('sortOrder' in spalte) &&
    zustandsSchluessel(spalte) != null
  );
}

/** Trägt die Spalte ein Filtermenü von antd? */
function hasFilterMenue<T>(spalte: KatalogSpalte<T>): boolean {
  return !('children' in spalte) && (spalte.filters != null || spalte.filterDropdown != null);
}

/** Schlüssel des Filtermenüs einer Spalte: ihr Zustandsschlüssel, sonst ihr Ort in der Garnitur. */
function filterMenueKey<T>(spalte: KatalogSpalte<T>, pos: string): string {
  return zustandsSchluessel(spalte) ?? `#${pos}`;
}

const childPos = (pos: string, i: number) => (pos === '' ? String(i) : `${pos}-${i}`);

/**
 * Hängt an jedes Filtermenü die Meldung „offen/zu“ (LLH-1427); ein eigenes `onOpenChange` der
 * Spalte hört weiter mit. antd ruft es bei jedem Öffnen und Schließen, auch über Bestätigen,
 * Zurücksetzen und Schließen sowie Escape.
 */
function trackFilterMenues<T>(
  spalten: readonly KatalogSpalte<T>[],
  report: (key: string, open: boolean) => void,
  pos = '',
): KatalogSpalte<T>[] {
  return spalten.map((spalte, i) => {
    const path = childPos(pos, i);
    if ('children' in spalte && spalte.children) {
      return {
        ...spalte,
        children: trackFilterMenues(spalte.children as KatalogSpalte<T>[], report, path),
      } as KatalogSpalte<T>;
    }
    if (!hasFilterMenue(spalte)) return spalte;
    const key = filterMenueKey(spalte, path);
    const own = spalte.filterDropdownProps;
    return {
      ...spalte,
      filterDropdownProps: {
        ...own,
        onOpenChange: (open: boolean) => {
          own?.onOpenChange?.(open);
          report(key, open);
        },
      },
    };
  });
}

/**
 * Was antds Filter- und Sortierzustand aus den Spalten liest, als Zeichenkette, dazu die
 * Schlüssel der Filtermenüs (LLH-1427). Ändert sich die Zeichenkette, darf eine gehaltene
 * Spaltenliste nicht stehen bleiben: antd rechnete sonst mit einem überholten Stand weiter.
 */
function buildFilterSignature<T>(
  spalten: readonly KatalogSpalte<T>[],
  pos = '',
): { signature: string[]; menueKeys: string[] } {
  const signature: string[] = [];
  const menueKeys: string[] = [];
  spalten.forEach((spalte, i) => {
    const path = childPos(pos, i);
    if ('children' in spalte && spalte.children) {
      const inner = buildFilterSignature(spalte.children as KatalogSpalte<T>[], path);
      signature.push(...inner.signature);
      menueKeys.push(...inner.menueKeys);
      return;
    }
    const key = filterMenueKey(spalte, path);
    if (hasFilterMenue(spalte)) menueKeys.push(key);
    const filter = 'filteredValue' in spalte ? JSON.stringify(spalte.filteredValue ?? null) : '-';
    const sortierung = 'sortOrder' in spalte ? String(spalte.sortOrder ?? null) : '-';
    signature.push(`${key}=${filter}|${String(spalte.filtered ?? '')}|${sortierung}`);
  });
  return { signature, menueKeys };
}

/** Jede Zelle zeichnet neu: einmal nach dem Loslassen einer gehaltenen Spaltenliste (LLH-1427). */
function forceCellUpdate<T>(spalten: readonly KatalogSpalte<T>[]): KatalogSpalte<T>[] {
  return spalten.map((spalte) =>
    'children' in spalte && spalte.children
      ? ({
          ...spalte,
          children: forceCellUpdate(spalte.children as KatalogSpalte<T>[]),
        } as KatalogSpalte<T>)
      : { ...spalte, shouldCellUpdate: () => true },
  );
}

function vorbelegteFilter<T>(
  spalten: readonly KatalogSpalte<T>[],
): Readonly<Record<string, readonly string[]>> {
  const stand: Record<string, readonly string[]> = {};
  for (const s of spalten) {
    if (!filterIntern(s) || !('defaultFilteredValue' in s) || !s.defaultFilteredValue) continue;
    if (s.defaultFilteredValue.length > 0) {
      stand[zustandsSchluessel(s)!] = s.defaultFilteredValue.map(String);
    }
  }
  return stand;
}

function vorbelegteSortierung<T>(spalten: readonly KatalogSpalte<T>[]): ListenSortierung {
  for (const s of spalten) {
    if (!sortierungIntern(s) || !('defaultSortOrder' in s) || !s.defaultSortOrder) continue;
    return {
      spalte: zustandsSchluessel(s)!,
      richtung: s.defaultSortOrder === 'ascend' ? 'auf' : 'ab',
    };
  }
  return null;
}

export default function KatalogTabelle<T extends object>({
  columns,
  dataSource,
  pagination,
  loading,
  locale,
  suche,
  spaltenSchalter,
  gedaechtnis,
  mehrzahl,
  ...rest
}: KatalogTabelleProps<T>) {
  const [suchbegriff, setSuchbegriff] = useState(() => gedaechtnis?.start.suche ?? '');
  // Filter und Sortierung der Spalten, die das Primitiv selbst führt (siehe Dateikopf, LLH-1086).
  const [filterStand, setFilterStand] = useState<Readonly<Record<string, readonly string[]>>>(
    () => gedaechtnis?.start.filter ?? vorbelegteFilter(columns ?? []),
  );
  const [sortStand, setSortStand] = useState<ListenSortierung>(() =>
    gedaechtnis ? gedaechtnis.start.sortierung : vorbelegteSortierung(columns ?? []),
  );
  const { token, rollen, dunkel } = useRollen();
  const kopfStilGefiltert = useMemo(() => kopfGefiltertStil(rollen), [rollen]);
  const { abBreite } = useViewport();
  const feldRef = useRef<InputRef>(null);
  const werkzeugWurzel = useRef<HTMLDivElement>(null);
  const tabelleRef = useRef<TableRef>(null);
  const druckt = useDruckModus();
  // Der Kopf steht unter dem klebenden Rahmen, in Drawer und Modal an deren Oberkante (LFH-952).
  const rahmenOben = useRahmenObenFuer(useCallback(() => tabelleRef.current?.nativeElement, []));
  useKopfFreiraum(tabelleRef);
  // Erste Zeile rückwärts getabbt: dort greift `scroll-margin-top` nicht (LLH-1358).
  useFokusUnterKopf(tabelleRef);
  useFilterTastatur(tabelleRef);
  useSlashKuerzel(suche != null, () => feldRef.current?.focus());

  // ── Spaltenschalter ───────────────────────────────────────────────────────────────
  // Zählung und Schalter kommen aus `SpaltenSchalter.tsx`; hier wohnt nur der Zustand.
  const [spaltenAus, setSpaltenAusRoh] = useState<readonly string[]>(
    () => gedaechtnis?.spaltenStart?.aus ?? [],
  );
  const [spaltenAn, setSpaltenAnRoh] = useState<readonly string[]>(
    () => gedaechtnis?.spaltenStart?.an ?? [],
  );
  const meldeSpalten = gedaechtnis?.meldeSpalten;
  const setSpaltenAus = useCallback(
    (k: string[]) => {
      setSpaltenAusRoh(k);
      meldeSpalten?.({ aus: k, an: spaltenAn });
    },
    [meldeSpalten, spaltenAn],
  );
  const setSpaltenAn = useCallback(
    (k: string[]) => {
      setSpaltenAnRoh(k);
      meldeSpalten?.({ aus: spaltenAus, an: k });
    },
    [meldeSpalten, spaltenAus],
  );
  const [spaltenOffen, setSpaltenOffen] = useState(false);
  const { schaltbar, ohneSchluessel } = useMemo(
    () => schaltbareFassung(columns ?? [], spaltenSchalter != null),
    [columns, spaltenSchalter],
  );
  const schalterDa = spaltenSchalter != null && hatWaehlbareSpalten(schaltbar);

  // Verschwindet der Schalter, feuert antd KEIN `onOpenChange(false)`; der kontrollierte Zustand
  // klappte beim Wiederauftauchen ungefragt auf (wie in `Datensicht`).
  useEffect(() => {
    if (!schalterDa) setSpaltenOffen(false);
  }, [schalterDa]);

  // Als Zeichenkette in die Deps: die Spaltenliste der Aufrufer ist je Render neu gebaut.
  const ohneSchluesselText = ohneSchluessel.join(', ');
  useEffect(() => {
    if (!import.meta.env.DEV || ohneSchluesselText === '') return;
    console.warn(
      `[KatalogTabelle] Spalte(n) ${ohneSchluesselText} ohne String-key — der ` +
        'Spaltenschalter braucht ihn, sie bleiben deshalb immer sichtbar.',
    );
  }, [ohneSchluesselText]);

  const abBreiteOhneSchalter = spaltenSchalter == null && (columns ?? []).some((s) => s.abBreite);
  useEffect(() => {
    if (!import.meta.env.DEV || !abBreiteOhneSchalter) return;
    console.warn(
      '[KatalogTabelle] Eine Spalte trägt abBreite, die Tabelle aber keinen spaltenSchalter — ' +
        'ohne Zähler wäre das eine stille Ausblendung, abBreite bleibt deshalb wirkungslos.',
    );
  }, [abBreiteOhneSchalter]);

  const filterZuruecksetzen = useCallback(() => {
    setSuchbegriff('');
    setFilterStand({});
  }, []);
  const internGefiltert = (columns ?? []).some(filterIntern);

  // Das Gedächtnis hört mit, entprellt und ohne den Anfangsstand (wie in `Datensicht`).
  const melde = gedaechtnis?.melde;
  const ersterStand = useRef(true);
  useEffect(() => {
    if (ersterStand.current) {
      ersterStand.current = false;
      return;
    }
    if (!melde) return;
    const frist = setTimeout(
      () => melde({ sortierung: sortStand, filter: filterStand, suche: suchbegriff }),
      GEDAECHTNIS_ENTPRELLUNG_MS,
    );
    return () => clearTimeout(frist);
  }, [melde, sortStand, filterStand, suchbegriff]);
  const oeffneSpalten = useCallback(() => setSpaltenOffen(true), []);
  // Nur melden, was die Werkzeugzeile auch hält (`hatWaehlbareSpalten`, dieselbe Wahrheit wie der
  // Schalter).
  const tastaturAktionen: TastaturAktionen = {
    ...(suche != null || internGefiltert ? { 'filter-zuruecksetzen': filterZuruecksetzen } : {}),
    ...(schalterDa ? { spalten: oeffneSpalten } : {}),
  };
  useTastaturEbene({
    name: 'Katalogtabelle-Filter',
    wurzel: werkzeugWurzel,
    aktionen: tastaturAktionen,
    aktiv: suche != null || schalterDa || internGefiltert,
  });

  /**
   * Die WIRKLICH gezeigte Garnitur. Ohne Opt-in unverändert; mit Opt-in über
   * {@link sichtbareSpalten}, das Spalte 0 nie entfernt. Die Schalterfelder werden vor antd
   * herausgelöst.
   */
  const gezeigteSpalten = useMemo(() => {
    if (!columns) return columns;
    let auswahl: readonly KatalogSpalte<T>[] = columns;
    if (spaltenSchalter != null) {
      const { spalten } = sichtbareSpalten({
        spalten: schaltbar,
        verborgen: new Set(spaltenAus),
        eingeblendet: new Set(spaltenAn),
        abBreite,
      });
      auswahl = spalten.map((s) => columns[s.index]);
    }
    return auswahl.map((spalte) => {
      const { etikett, immerSichtbar, abBreite: _ab, ...antd } = spalte;
      void etikett;
      void immerSichtbar;
      void _ab;
      const gebaut = { ...antd } as KatalogSpalte<T> & {
        defaultFilteredValue?: unknown;
        defaultSortOrder?: unknown;
      };
      const k = zustandsSchluessel(spalte);
      // Kontrolliert (LLH-1086): die Vorbelegung ist schon im Zustand, antd bekommt den Stand.
      if (k != null && filterIntern(spalte)) {
        delete gebaut.defaultFilteredValue;
        const gewaehlt = filterStand[k] ?? [];
        gebaut.filteredValue = gewaehlt.length > 0 ? [...gewaehlt] : null;
        if (gewaehlt.length > 0) {
          const eigen = spalte.onHeaderCell;
          gebaut.onHeaderCell = (s) => {
            const basis = eigen?.(s) ?? {};
            return { ...basis, style: { ...basis.style, ...kopfStilGefiltert } };
          };
        }
      }
      if (k != null && sortierungIntern(spalte)) {
        delete gebaut.defaultSortOrder;
        gebaut.sortOrder =
          sortStand?.spalte === k ? (sortStand.richtung === 'auf' ? 'ascend' : 'descend') : null;
      }
      return gebaut as KatalogSpalte<T>;
    });
  }, [
    columns,
    spaltenSchalter,
    schaltbar,
    spaltenAus,
    spaltenAn,
    abBreite,
    filterStand,
    sortStand,
    kopfStilGefiltert,
  ]);

  /**
   * Die wirksamen eigenen Filter: nur gezeigte Spalten, wie antd sie anwendet. Daraus Chips,
   * Merkmale und die Trefferzahl; ohne `onFilter` (der Aufrufer filtert selbst) zählt das Primitiv
   * nicht.
   */
  const eigeneFilterSpalten = useMemo(() => {
    const intern = new Set((columns ?? []).filter(filterIntern).map(zustandsSchluessel));
    return (gezeigteSpalten ?? []).filter((s) => intern.has(zustandsSchluessel(s)));
  }, [gezeigteSpalten, columns]);
  const filterListe = aktiveFilter(
    eigeneFilterSpalten.map((s) => ({
      key: zustandsSchluessel(s)!,
      etikett:
        (columns ?? []).find((c) => zustandsSchluessel(c) === zustandsSchluessel(s))?.etikett ??
        (typeof s.title === 'string' ? s.title : zustandsSchluessel(s)!),
      werte: ('filters' in s ? (s.filters ?? []) : []).map((f) => ({
        text:
          typeof f.text === 'string' || typeof f.text === 'number'
            ? String(f.text)
            : String(f.value),
        value: String(f.value),
      })),
    })),
    filterStand,
  );

  /**
   * DIE EINE Quelle der gerenderten Zeilen. Bewusst nicht `effektiveDaten` genannt: der Name
   * bezeichnet in `Datensicht.tsx` eine größere Operation.
   */
  const sichtbareZeilen = useMemo(() => {
    const begriff = suchbegriff.trim().toLowerCase();
    if (begriff === '' || !dataSource) return dataSource;
    // `suchText` gewinnt über `dataIndex`; eine Spalte ohne beides (render-only, Gruppe) trägt nicht
    // bei.
    const suchbar = (columns ?? []).filter(
      (s) => s.suchText != null || (!('children' in s) && 'dataIndex' in s),
    );
    return dataSource.filter((zeile) =>
      suchbar.some((spalte) => {
        const wert = spalte.suchText ? spalte.suchText(zeile) : zellenWert(spalte, zeile);
        return wert != null && String(wert).toLowerCase().includes(begriff);
      }),
    );
  }, [dataSource, columns, suchbegriff]);

  /**
   * Treffer unter Suche UND eigenen Filtern für den `Filterhinweis` (LLH-1086), mit denselben
   * `onFilter` wie antd. Filtert eine aktive Spalte ohne `onFilter` (der Aufrufer filtert selbst),
   * zählt das Primitiv nicht: eine falsche Zahl wäre schlimmer als keine.
   */
  const trefferZahl = useMemo(() => {
    let zeilen = sichtbareZeilen ?? [];
    for (const spalte of eigeneFilterSpalten) {
      const gewaehlt = filterStand[zustandsSchluessel(spalte)!] ?? [];
      if (gewaehlt.length === 0) continue;
      const pruefe = 'onFilter' in spalte ? spalte.onFilter : undefined;
      if (!pruefe) return undefined;
      zeilen = zeilen.filter((z) => gewaehlt.some((w) => pruefe(w, z)));
    }
    return zeilen.length;
  }, [sichtbareZeilen, eigeneFilterSpalten, filterStand]);
  const eingeschraenkt = suchbegriff.trim() !== '' || filterListe.length > 0;

  /**
   * Zähler je Filterwert im Kopfmenü („Groß (3)“, LLH-1096, wie in `Datensicht`): wie viele Zeilen
   * der Wert unter Suche und den ÜBRIGEN eigenen Filtern träfe. Gezählt wird mit dem `onFilter` der
   * Spalten; fehlt es an der gezählten oder an einer übrigen aktiven Spalte, steht keine Zahl (eine
   * falsche wäre schlimmer). Chips und Filterhinweis lesen weiter die Werte ohne Zahl.
   */
  const gezaehlteSpalten = useMemo(() => {
    if (!gezeigteSpalten) return gezeigteSpalten;
    const basis = sichtbareZeilen ?? [];
    const pruefung = new Map(
      eigeneFilterSpalten.map((s) => [
        zustandsSchluessel(s)!,
        'onFilter' in s ? s.onFilter : undefined,
      ]),
    );
    const zaehlbar = (k: string) => {
      for (const [andere, pruefe] of pruefung) {
        if (andere !== k && (filterStand[andere]?.length ?? 0) > 0 && !pruefe) return false;
      }
      return pruefung.get(k) != null;
    };
    return gezeigteSpalten.map((spalte) => {
      const k = zustandsSchluessel(spalte);
      if (k == null || !pruefung.has(k) || !zaehlbar(k) || !('filters' in spalte)) return spalte;
      let menge = basis;
      for (const [andere, pruefe] of pruefung) {
        const gewaehlt = filterStand[andere] ?? [];
        if (andere === k || gewaehlt.length === 0 || !pruefe) continue;
        menge = menge.filter((z) => gewaehlt.some((w) => pruefe(w, z)));
      }
      const pruefe = pruefung.get(k)!;
      return {
        ...spalte,
        filters: (spalte.filters ?? []).map((f) => ({
          ...f,
          text: `${typeof f.text === 'string' || typeof f.text === 'number' ? f.text : String(f.value)} (${
            menge.filter((z) => pruefe(f.value as Key | boolean, z)).length
          })`,
        })),
      } as KatalogSpalte<T>;
    });
  }, [gezeigteSpalten, sichtbareZeilen, eigeneFilterSpalten, filterStand]);

  /**
   * Fixiert wird die ERSTE Spalte: sie ist überall die menschenlesbare Kennung, ein Pflicht-Prop
   * wäre Zeremonie. Unangetastet bleibt sie, wenn der Aufrufer eine Seite gewählt hat oder dort
   * eine Spaltengruppe steht (deren Fixierung wirkungslos wäre).
   */
  const fixierteSpalten = useMemo(() => {
    // Mono-Spalten bekommen ihre Klasse vor dem Fixieren; die Spaltenfolge bleibt.
    const gestaltet = gezaehlteSpalten?.map((s) =>
      s.zahl ? { ...s, className: [s.className, 'lfh-zahl-spalte'].filter(Boolean).join(' ') } : s,
    );
    const erste = gestaltet?.[0];
    if (!gestaltet || !erste || erste.fixed !== undefined || 'children' in erste) return gestaltet;
    return [{ ...erste, fixed: 'left' as const }, ...gestaltet.slice(1)];
  }, [gezaehlteSpalten]);

  /**
   * Hält den eigenen Zustand nach und reicht das Ereignis an den Aufrufer weiter. Spalten, die der
   * Aufrufer kontrolliert, bleiben unberührt.
   */
  const aufruferOnChange = rest.onChange;
  const beiAenderung = useCallback<NonNullable<TableProps<T>['onChange']>>(
    (seite, filter, sorter, extra) => {
      if (extra?.action === 'filter') {
        setFilterStand((vorher) => {
          const neu: Record<string, readonly string[]> = { ...vorher };
          for (const spalte of eigeneFilterSpalten) {
            const k = zustandsSchluessel(spalte)!;
            const werte = (filter[k] ?? []).map(String);
            if (werte.length > 0) neu[k] = werte;
            else delete neu[k];
          }
          return neu;
        });
      }
      if (extra?.action === 'sort') {
        const einzeln = Array.isArray(sorter) ? sorter[0] : sorter;
        const k =
          typeof einzeln?.columnKey === 'string'
            ? einzeln.columnKey
            : typeof einzeln?.field === 'string'
              ? einzeln.field
              : undefined;
        const spalte = (columns ?? []).find((c) => zustandsSchluessel(c) === k);
        if (k != null && spalte && sortierungIntern(spalte)) {
          setSortStand(
            einzeln?.order
              ? { spalte: k, richtung: einzeln.order === 'ascend' ? 'auf' : 'ab' }
              : null,
          );
        }
      }
      aufruferOnChange?.(seite, filter, sorter, extra);
    },
    [eigeneFilterSpalten, columns, aufruferOnChange],
  );

  /**
   * Die gedeckelte Tabellenbreite, gerechnet über `fixierteSpalten`, die WIRKLICH gerenderte
   * Garnitur; ein Deckel aus der Vollmenge wäre zu breit.
   */
  const { x: scrollX, warnung: breitenWarnung } = useMemo(
    () => fliessBreite(fixierteSpalten),
    [fixierteSpalten],
  );
  useEffect(() => {
    if (!import.meta.env.DEV || breitenWarnung == null) return;
    console.warn(`[KatalogTabelle] ${breitenWarnung}`);
  }, [breitenWarnung]);

  /**
   * EIN OFFENES FILTERMENÜ BEHÄLT SEINEN ENTWURF (LLH-1427). antds `FilterDropdown` setzt die
   * angehakten, noch nicht bestätigten Werte eines offenen Menüs auf `filteredKeys` zurück, sobald
   * deren Referenz wechselt (Effekt auf `[propFilteredKeys, mergedVisible]`), und `useFilter`
   * bildet `filteredValue` für jede neue Spaltenliste neu ab (`map(String)`). Jede neue Liste
   * verwarf so den Entwurf einer schon gefilterten Spalte: neue Zeilen (die Zähler ändern die
   * Spalten), ein Neuaufbau der `Datensicht` (sie baut ihre Spalten je Render), das Schreiben der
   * Adresse. Memoisieren allein reicht nicht, weil ein neuer Zähler die Spalte ändern MUSS.
   *
   * Deshalb bekommt antd, solange ein Filtermenü offen ist, die Spaltenliste vom Öffnen: Zähler und
   * Zellen-Closures stehen bis zum Schließen, Zeilen fließen weiter. Ändert sich ein Filter- oder
   * Sortierstand, gilt sofort die neue Liste (`signature`), sonst rechnete antd mit einem alten
   * Stand. Beim Loslassen zeichnet die Tabelle einmal alle Zellen, damit nichts aus der gehaltenen
   * Garnitur stehen bleibt (die `Datensicht` hat ihren Garniturwechsel dann schon gezeigt).
   */
  const [offeneFilterMenues, setOffeneFilterMenues] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const reportFilterMenue = useCallback((key: string, open: boolean) => {
    setOffeneFilterMenues((vorher) => {
      if (vorher.has(key) === open) return vorher;
      const neu = new Set(vorher);
      if (open) neu.add(key);
      else neu.delete(key);
      return neu;
    });
  }, []);
  const meldendeSpalten = useMemo(
    () => fixierteSpalten && trackFilterMenues(fixierteSpalten, reportFilterMenue),
    [fixierteSpalten, reportFilterMenue],
  );
  const { signature, menueKeys, menueKeyText } = useMemo(() => {
    const fassung = buildFilterSignature(meldendeSpalten ?? []);
    return {
      signature: fassung.signature.join('\n'),
      menueKeys: new Set(fassung.menueKeys),
      menueKeyText: fassung.menueKeys.join('\n'),
    };
  }, [meldendeSpalten]);
  // Ein Menü, dessen Spalte verschwunden ist, meldet sein Schließen nie: es hält nicht und fällt aus
  // der Menge, damit es nach seiner Rückkehr nicht als offen gilt.
  useEffect(() => {
    const da = new Set(menueKeyText.split('\n'));
    setOffeneFilterMenues((vorher) =>
      [...vorher].every((k) => da.has(k)) ? vorher : new Set([...vorher].filter((k) => da.has(k))),
    );
  }, [menueKeyText]);
  const isHolding =
    meldendeSpalten != null && [...offeneFilterMenues].some((k) => menueKeys.has(k));
  const [gehalten, setGehalten] = useState<
    { spalten: KatalogSpalte<T>[]; signature: string } | 'loslassen' | null
  >(null);
  // Abgeleiteter Zustand im Render (Reacts Muster für „Stand vom vorigen Render“): nur beim
  // Öffnen, bei neuem Filter- oder Sortierstand und beim Schließen, also ohne Schleife.
  if (isHolding) {
    if (gehalten == null || gehalten === 'loslassen' || gehalten.signature !== signature) {
      setGehalten({ spalten: meldendeSpalten!, signature });
    }
  } else if (gehalten != null && gehalten !== 'loslassen') {
    setGehalten('loslassen');
  }
  useEffect(() => {
    if (gehalten === 'loslassen') setGehalten(null);
  }, [gehalten]);
  const antdSpalten =
    isHolding && gehalten != null && gehalten !== 'loslassen' && gehalten.signature === signature
      ? gehalten.spalten
      : gehalten === 'loslassen' && meldendeSpalten
        ? forceCellUpdate(meldendeSpalten)
        : meldendeSpalten;

  const identifier = bezugsSchluessel(columns?.[0]);
  useEffect(() => {
    if (!import.meta.env.DEV || identifier !== 'id') return;
    console.warn(
      '[KatalogTabelle] Die fixierte erste Spalte zeigt auf die Datenbank-Kennung. ' +
        'Die Bedien-Leitlinie verlangt dort eine menschenlesbare Kennung — ' +
        'Funkrufname, Bezeichnung oder Ordnungsnummer.',
    );
  }, [identifier]);

  /**
   * Die Schwelle rechnet gegen die ÜBERGEBENE Menge (siehe Dateikopf). `showSizeChanger: false`:
   * rc-pagination schaltete ihn ab `total > 50` selbst ein und schöbe das breiteste Element in eine
   * Leiste, die bei 390 px gemessen wird.
   */
  /**
   * Ladend schlägt leer. `emptyText: null` statt Weglassen des Schlüssels: ein fehlender Schlüssel
   * fiele auf `renderEmpty` („Keine Daten“) zurück. Der Rest von `locale` bleibt stehen.
   */
  const wirkendesLocale = istLadend(loading) ? { ...locale, emptyText: null } : locale;

  const blaetterung =
    pagination ??
    ((dataSource?.length ?? 0) > BLAETTER_SCHWELLE
      ? { pageSize: BLAETTER_SCHWELLE, showSizeChanger: false }
      : (false as const));

  return (
    <>
      {(suche != null || schalterDa) && (
        // Die Werkzeugzeile liegt AUSSERHALB von `.ant-table`: `katalogtabelle-schmal.spec.ts` misst
        // `scrollWidth` am Tabellenwurzelknoten. Umbrechende Flex-Zeile mit `gap`.
        <div
          ref={werkzeugWurzel}
          data-lfh="katalog-werkzeuge"
          style={{
            marginBlockEnd: 8,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: werkzeugAbstand(token),
          }}
        >
          {suche != null && (
            <Input.Search
              ref={feldRef}
              allowClear
              placeholder={suche.platzhalter}
              value={suchbegriff}
              onChange={(e) => setSuchbegriff(e.target.value)}
              // Kein `size`-Prop: die Höhe kommt aus `controlHeight`. Die Breite folgt dem Platzhalter.
              style={suchfeldStil(suche.platzhalter, !abBreite('md'), token)}
            />
          )}
          {schalterDa && (
            <SpaltenSchalter
              bezeichnung={spaltenSchalter.bezeichnung}
              spalten={schaltbar}
              aus={spaltenAus}
              onAus={setSpaltenAus}
              an={spaltenAn}
              onAn={setSpaltenAn}
              offen={spaltenOffen}
              onOffen={setSpaltenOffen}
            />
          )}
        </div>
      )}
      {eingeschraenkt && (
        <div
          data-lfh="katalog-einschraenkung"
          style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBlockEnd: 8 }}
        >
          <Filterhinweis
            treffer={trefferZahl}
            gesamt={dataSource?.length}
            merkmale={filterMerkmale(suchbegriff, filterListe)}
            onZuruecksetzen={filterZuruecksetzen}
            dinge={mehrzahl}
          />
          <FilterChips
            filter={filterListe}
            onEntfernen={(spalte, wert) =>
              setFilterStand((vorher) => {
                const rest = (vorher[spalte] ?? []).filter((w) => w !== wert);
                const { [spalte]: _alt, ...uebrig } = vorher;
                void _alt;
                return rest.length > 0 ? { ...uebrig, [spalte]: rest } : uebrig;
              })
            }
          />
        </div>
      )}
      {/* Geschachtelter Provider nur für die Tabellen-Tokens: er erbt Algorithmus, Rollen und Dichte
          und färbt NUR diese Tabelle; `tokens.ts:antdKomponenten` bleibt die globale Stelle. */}
      <ConfigProvider theme={{ components: { Table: tabellenTokens(rollen, dunkel, token) } }}>
        <Table<T>
          {...rest}
          onChange={beiAenderung}
          ref={tabelleRef}
          className={['lfh-katalog', rest.className].filter(Boolean).join(' ')}
          style={{ ...filterKopfStil(token), ...rest.style }}
          columns={antdSpalten}
          dataSource={sichtbareZeilen}
          loading={loading}
          locale={wirkendesLocale}
          pagination={blaetterung}
          // `test/utils.tsx` montiert `ConfigProvider` ohne Locale; der Sortier-Tooltip wäre im Test
          // englisch und in Produktion deutsch. Am Berührungsgerät trägt er ohnehin nichts.
          showSorterTooltip={false}
          scroll={{ x: scrollX }}
          /*
           * rc-table wählt das Layout selbst: `if (fixColumn) return mergedScrollX === 'max-content' ?
           * 'auto' : 'fixed'`. Dieses Primitiv fixiert Spalte 0 immer; eine Zahl kippte das Layout still
           * auf `fixed`, wo Spaltenbreiten BINDEND sind (ein 72-px-Knopf in einer 96-px-Aktionsspalte wurde
           * angeschnitten). Nur im Zahlfall gesetzt: bei `'max-content'` wählt rc-table ohnehin `auto`, und
           * bei einer Gruppe an Position 0 wäre ein hartes `auto` eine stille Änderung.
           */
          tableLayout={typeof scrollX === 'number' ? 'auto' : undefined}
          /*
           * Stehende Kopfzeile am Bildschirm, NICHT im Druck: mit `sticky` legt rc-table den Kopf in eine
           * eigene Tabelle, der Körper trüge kein `thead`, und die Kopfwiederholung aus `druck/druck.css`
           * griffe nicht. Umgeschaltet über `beforeprint`/`afterprint`. Der Kopf steht unter dem
           * klebenden Rahmen, nicht an der Fensterkante (LFH-952, `frontend/AGENTS.md`, Rahmen).
           */
          sticky={druckt ? false : { offsetHeader: rahmenOben }}
        />
      </ConfigProvider>
    </>
  );
}
