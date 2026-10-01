import { ConfigProvider, Input, Table, type InputRef, type TableProps, type TableRef } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
 * eigene Suche, `Datensicht` bringt seine mit). Gesucht wird über {@link zellenWert}, also nur in
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
 * · Was man nicht sieht, wirkt nicht: antd hält Filter- und Sortierzustand nur für übergebene
 *   Spalten, eine ausgeblendete gefilterte Spalte siebt nicht (gepinnt in
 *   `OnlineQuellenVerwaltung.test.tsx`).
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
 * Kopfzeile auf `kopf`, Kopftext `gedaempft` (7,37 Tag · 7,48 Nacht; `schwach` lag am Tag bei
 * 5,58, LFH-652), keine senkrechten Trenner im Kopf. Zeilentrenner als
 * Haarlinie: nachts `flaeche2`, am Tag `flaeche3` (`flaeche2` läge dort bei 1,08 : 1 auf Weiß).
 * Hover auf `flaeche3` aus demselben Grund. Die Zellpolsterung folgt der Dichte-Staffel
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
};

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
}

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

export default function KatalogTabelle<T extends object>({
  columns,
  dataSource,
  pagination,
  loading,
  locale,
  suche,
  spaltenSchalter,
  ...rest
}: KatalogTabelleProps<T>) {
  const [suchbegriff, setSuchbegriff] = useState('');
  const { token, rollen, dunkel } = useRollen();
  const { abBreite } = useViewport();
  const feldRef = useRef<InputRef>(null);
  const werkzeugWurzel = useRef<HTMLDivElement>(null);
  const tabelleRef = useRef<TableRef>(null);
  const druckt = useDruckModus();
  useKopfFreiraum(tabelleRef);
  useSlashKuerzel(suche != null, () => feldRef.current?.focus());

  // ── Spaltenschalter ───────────────────────────────────────────────────────────────
  // Zählung und Schalter kommen aus `SpaltenSchalter.tsx`; hier wohnt nur der Zustand.
  const [spaltenAus, setSpaltenAus] = useState<readonly string[]>([]);
  const [spaltenAn, setSpaltenAn] = useState<readonly string[]>([]);
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

  const filterZuruecksetzen = useCallback(() => setSuchbegriff(''), []);
  const oeffneSpalten = useCallback(() => setSpaltenOffen(true), []);
  // Nur melden, was die Werkzeugzeile auch hält (`hatWaehlbareSpalten`, dieselbe Wahrheit wie der
  // Schalter).
  const tastaturAktionen: TastaturAktionen = {
    ...(suche != null ? { 'filter-zuruecksetzen': filterZuruecksetzen } : {}),
    ...(schalterDa ? { spalten: oeffneSpalten } : {}),
  };
  useTastaturEbene({
    name: 'Katalogtabelle-Filter',
    wurzel: werkzeugWurzel,
    aktionen: tastaturAktionen,
    aktiv: suche != null || schalterDa,
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
      return antd as KatalogSpalte<T>;
    });
  }, [columns, spaltenSchalter, schaltbar, spaltenAus, spaltenAn, abBreite]);

  /**
   * Fixiert wird die ERSTE Spalte: sie ist überall die menschenlesbare Kennung, ein Pflicht-Prop
   * wäre Zeremonie. Unangetastet bleibt sie, wenn der Aufrufer eine Seite gewählt hat oder dort
   * eine Spaltengruppe steht (deren Fixierung wirkungslos wäre).
   */
  const fixierteSpalten = useMemo(() => {
    // Mono-Spalten bekommen ihre Klasse vor dem Fixieren; die Spaltenfolge bleibt.
    const gestaltet = gezeigteSpalten?.map((s) =>
      s.zahl ? { ...s, className: [s.className, 'lfh-zahl-spalte'].filter(Boolean).join(' ') } : s,
    );
    const erste = gestaltet?.[0];
    if (!gestaltet || !erste || erste.fixed !== undefined || 'children' in erste) return gestaltet;
    return [{ ...erste, fixed: 'left' as const }, ...gestaltet.slice(1)];
  }, [gezeigteSpalten]);

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
            gap: token.paddingXS,
          }}
        >
          {suche != null && (
            <Input.Search
              ref={feldRef}
              allowClear
              placeholder={suche.platzhalter}
              value={suchbegriff}
              onChange={(e) => setSuchbegriff(e.target.value)}
              // Kein `size`-Prop: die Höhe kommt aus `controlHeight`. Fluide Breite statt fester Zahl.
              style={{ width: '100%', maxWidth: 220 }}
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
      {/* Geschachtelter Provider nur für die Tabellen-Tokens: er erbt Algorithmus, Rollen und Dichte
          und färbt NUR diese Tabelle; `tokens.ts:antdKomponenten` bleibt die globale Stelle. */}
      <ConfigProvider theme={{ components: { Table: tabellenTokens(rollen, dunkel, token) } }}>
        <Table<T>
          {...rest}
          ref={tabelleRef}
          className={['lfh-katalog', rest.className].filter(Boolean).join(' ')}
          columns={fixierteSpalten}
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
           * griffe nicht. Umgeschaltet über `beforeprint`/`afterprint`.
           */
          sticky={!druckt}
        />
      </ConfigProvider>
    </>
  );
}
