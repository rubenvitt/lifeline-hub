import { Input, Table, type InputRef, type TableProps } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';

/**
 * Geteiltes Tabellen-Primitiv der Katalog-/Verwaltungsseiten (LFH-329 · B1).
 *
 * Erfüllt Gate 2 der Bedien-Leitlinie („Tabelle nur, wenn verglichen wird — dann
 * vollständig") an genau EINER Stelle statt an neunzehn. Drei Merkmale setzt das
 * Primitiv unbedingt, sie gehören ihm und nicht dem Aufrufer:
 *
 * 1. **Waagerechter Scrollcontainer über die Spaltenbreite.** Auf schmalem Schirm wird
 *    die Tabelle angepasst, nicht in Karten aufgelöst (A1, Festlegung 2) — sie scrollt
 *    in sich und drückt die Seite nicht breit.
 * 2. **Stehende Kopfzeile.** Beim Scrollen bleibt die Spaltenbedeutung lesbar. Antd zieht
 *    Kopf und Körper dafür in zwei `<table>`-Elemente auseinander und schiebt eine
 *    verborgene Messzeile als erste Körperzeile ein — wer Zeilen im Test greift, muss
 *    daher auf die Datenzeile (`tr.ant-table-row`) verengen.
 * 3. **Fixierte Identifierspalte.** Die erste Spalte bleibt beim waagerechten Scrollen
 *    stehen. Fixiert wird ausdrücklich die MENSCHENLESBARE Kennung (Funkrufname,
 *    Bezeichnung, Ordnungsnummer), nie die Datenbank-Kennung — dagegen steht die
 *    DEV-Warnung unten.
 *
 * Die WERTE des Übrigen (Zeilenschlüssel, Ladezustand, Leertext) bleiben beim Aufrufer: die
 * Aufrufstellen setzen sie heute selbst und behalten sie, was den Migrations-Diff je Datei
 * auf zwei Zeilen hält. Ihre VERSCHRÄNKUNG dagegen gehört hierher — siehe den Abschnitt zu
 * den drei Zuständen unten.
 *
 * ── ZWEI ADDITIVE ERWEITERUNGEN (LFH-330 · B2) ──────────────────────────────────
 *
 * **Suche — opt-in, nicht opt-out.** Ohne `suche`-Prop existiert weder Feld noch
 * Werkzeugzeile. Default-AN wäre in drei gemessenen Fällen Schaden statt Nutzen:
 * `pages/SchaedenPage.tsx` hat bereits ein eigenes `Input.Search` mit ANDERER Semantik
 * (Ort/Beschreibung), `etb/EtbTabelle.tsx` sucht serverweit über ein 100-Zeilen-Fenster,
 * und `Datensicht` nutzt dieses Primitiv intern und brächte sein eigenes Feld daneben.
 *
 * Die Suche liest die Rohdaten über {@link zellenWert}, also nur Spalten mit auflösbarem
 * Datenbezug. **Render-only-Spalten tragen ohne Zutun NICHT bei** — der Zellinhalt entsteht
 * erst beim Rendern. Das bleibt die Vorgabe und steht in `KatalogTabelle.test.tsx` als
 * negative Zusicherung.
 *
 * **Die Grenze ist seit LFH-346 · C11 eine ANNAHME mit Ausweg, keine Wand:** eine Spalte darf
 * einen {@link KatalogSpalte.suchText}-Haken tragen — dieselbe Signatur und denselben Namen
 * wie `DatensichtSpalte.suchText`, damit es EIN Begriff bleibt und nicht zwei. Anlass war die
 * ETB-Baustein-Tabelle, deren Inhaltstext mit der Zwei-Zeilen-Zelle in ein `render` wanderte
 * und damit aus dem Korpus fiel; wer einen Baustein an einer Wendung des Vorlagentextes
 * sucht, ist der häufigere Fall.
 *
 * **Vorrang: `suchText` gewinnt.** Trägt eine Spalte beides, wird NUR der Haken bewertet, nie
 * zusätzlich der `dataIndex` — sonst hinge der Korpus einer Spalte an der Frage, ob ihr
 * Datenbezug zufällig noch dasteht, und ein Haken könnte nur erweitern, nie ersetzen. Ein
 * Haken, der weniger liefert als der Rohwert, ist damit eine bewusste Verengung. Gepinnt von
 * `KatalogTabelle.test.tsx` mit einer Spalte, deren Haken den `dataIndex`-Wert VERDECKT.
 *
 * `Datensicht` bleibt der Weg für die grössere Kür (Spaltenschalter, Kartenzweig, Gruppen);
 * es reicht seine eigenen Spalten OHNE `suchText` hier herein und ist von diesem Haken
 * unberührt.
 *
 * **Blätterung — ab {@link BLAETTER_SCHWELLE} Zeilen, sonst nicht.** Antds Default wäre
 * zehn Zeilen und blätterte damit fast jede Aufrufstelle. Die Schwelle rechnet gegen
 * `dataSource.length`, NICHT gegen die gefilterte Menge: sonst verschwände die Leiste beim
 * Tippen und erzeugte genau den Layoutsprung, gegen den Prüflisten-Kriterium 12 existiert.
 * Aus demselben Grund ist `hideOnSinglePage` nicht der Mechanismus. Ein übergebenes
 * `pagination` gewinnt immer (`??`, nicht `||` — sonst verlöre ein gesetztes `false`).
 *
 * Kein Spaltenschalter: die Tabellen hier tragen höchstens sieben Spalten, alle sichtbar.
 * Die vierte Gate-2-Anforderung bleibt für diese Familie „nicht anwendbar" — den Schalter
 * für breite Einsatzflächen trägt `Datensicht` (LFH-330 · B2), nicht dieses Primitiv.
 *
 * ── DREI ZUSTÄNDE — UND DIE LADEUNTERDRÜCKUNG LEBT HIER (LFH-331 · B3, D4) ───────
 *
 * Dieses Primitiv kennt **ladend** (`loading`), **leer** (`dataSource` ohne Zeile) und
 * **gefüllt**. Den vierten Zustand — **Fehler** — trägt es ausdrücklich NICHT: er wird an
 * der Seite gegen `SeitenFehler` getauscht, bevor die Tabelle überhaupt montiert ist (D3).
 * Ein `fehler`-Prop wirkte hier nur unter `form="tabelle"` und täte im Kartenzweig von
 * `Datensicht` nichts, weil `ListeProps` keinen Fehlerbegriff kennt — zwei Wahrheiten für
 * dieselbe Sache.
 *
 * **Ladend und leer schließen sich aus, und das wird an genau EINER Stelle entschieden:
 * hier.** Solange geladen wird, wird nichts über die Menge behauptet — der Leertext wird
 * unterdrückt (`locale.emptyText` auf `null`), der Leerknoten fällt aus dem DOM. Vorbild ist
 * `Liste.tsx` (`const leer = loading ? null : …`), das seit je so gebaut ist. Ohne diese
 * Stelle behaupteten alle Aufrufstellen beim ersten Rendern „Noch keine …", bevor eine Zeile
 * überhaupt da sein kann, und Tabellen- und Kartenzweig von `Datensicht` verhielten sich
 * ungleich. Deshalb dürfen `loading` und `locale` NICHT durch `...rest` an antd
 * durchfallen; beide werden ausgepackt und verschränkt.
 *
 * Ehrlich gemacht: bei GANZ FEHLENDER `dataSource` unterdrückt antd schon selbst
 * (`rawData === EMPTY_LIST`). Diese Stelle deckt den Fall `[]` — den alle Aufrufstellen
 * fahren, weil sie `daten ?? []` übergeben — und damit den einzigen, der ohne sie leckt.
 *
 * Zwei gemessene Feinheiten, die eine naive Fassung verfehlt:
 *
 * · `loading` ist `boolean | SpinProps`. Ein OBJEKT ohne `spinning` lädt ebenfalls
 *   (`antd/es/table/hooks/useSpinProps.js`: `{ spinning: true, ...loading }`) — eine
 *   Prüfung auf `loading === true` ließe diese Form still durch.
 * · `emptyText: null` unterdrückt wirklich und fällt NICHT auf `renderEmpty` zurück:
 *   `antd/es/table/InternalTable.js` prüft `typeof locale?.emptyText !== 'undefined'`.
 *   Das ist gemessenes antd-Verhalten, kein zugesicherter Vertrag — es steht deshalb als
 *   Pin in `KatalogTabelle.test.tsx` und bricht sichtbar bei einem antd-Bump.
 */
export type KatalogSpalte<T> = NonNullable<TableProps<T>['columns']>[number] & {
  /**
   * Beitrag dieser Spalte zur Freitextsuche. Gleiche Signatur und gleicher Name wie
   * `DatensichtSpalte.suchText` (`components/Datensicht.tsx`) — EIN Begriff, zwei Träger.
   *
   * Fehlt er, bleibt es beim alten Verhalten (Rohwert über den `dataIndex`-Pfad). Ist er da,
   * gewinnt er: der `dataIndex` derselben Spalte wird dann NICHT zusätzlich bewertet.
   *
   * Das Feld gehört diesem Primitiv, nicht antd. Es fällt trotzdem mit an `<Table>` durch,
   * und das ist gemessen statt vermutet: `@rc-component/table` reicht an eine Zelle nur die
   * Rückgabe von `onCell`/`onHeaderCell` durch (`es/Cell/index.js`, `additionalProps`), nie
   * die Spaltenfelder selbst — ein unbekanntes Feld landet also in keinem DOM-Attribut.
   */
  suchText?: (zeile: T) => string | null | undefined;
  /**
   * Diese Spalte FLIESST: sie nimmt den Rest der Sichtbreite und bricht ihren Inhalt um,
   * statt die Tabelle zu verbreitern. Der Wert ist ihr Mindestmaß in px (LFH-523).
   *
   * Gegenstück zu antds `width`, nicht Ergänzung: eine Spalte trägt das eine ODER das
   * andere. `width` sagt „so breit", `mindestBreite` sagt „mindestens so breit, sonst der
   * Rest" — und genau dieser Rest fehlte dem Meldungstext des Einsatztagebuchs.
   *
   * OPT-IN, und das ist der Punkt: ohne diesen Haken bleibt jede der achtzehn
   * Katalogtabellen inhaltsgetrieben wie bisher. Siehe {@link fliessBreite}.
   */
  mindestBreite?: number;
};

export type KatalogTabelleProps<T> = Omit<
  TableProps<T>,
  'scroll' | 'sticky' | 'columns' | 'tableLayout'
> & {
  /**
   * Wie antds `columns`, je Spalte um {@link KatalogSpalte.suchText} erweitert. Der Zusatz ist
   * OPTIONAL — eine als `TableColumnsType<T>` annotierte Spaltenliste bleibt zuweisbar, und
   * genau deshalb ändert sich an den übrigen Aufrufstellen nichts.
   */
  columns?: KatalogSpalte<T>[];
  /**
   * Schaltet Werkzeugzeile und Freitextsuche ein. Ohne dieses Prop existiert beides nicht.
   * Die Suche greift Spalten mit auflösbarem `dataIndex` sowie Spalten mit `suchText` —
   * siehe Dateikopf.
   */
  suche?: { platzhalter: string };
};

/** Ab dieser Zeilenzahl blättert das Primitiv von selbst. */
export const BLAETTER_SCHWELLE = 50;

type Spalte<T> = NonNullable<TableProps<T>['columns']>[number];

/**
 * Der bewertbare Schlüssel eines Spaltenbezugs. Antd erlaubt neben `'name'` auch die
 * Pfadform `['meta', 'id']`; bewertet wird dann das letzte Glied, weil es das
 * angezeigte Feld benennt. Alles Nicht-Textliche (Zahl-Index) ist nicht bewertbar.
 *
 * NUR für die DEV-Warnung unten. **Nicht** als Suchresolver benutzen: `['meta','id']`
 * fällt hier auf `'id'` zusammen, und `zeile['id']` ist nicht `zeile.meta.id` — das wäre
 * ein still falscher Wert. Dafür gibt es {@link zellenWert}, das den vollen Pfad läuft.
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
export interface Fliessmass {
  /** Was als `scroll.x` an antd geht. */
  x: number | 'max-content';
  /** Gesetzt, wenn ein Opt-in vorlag, aber nicht trug. Wird in DEV gemeldet. */
  warnung?: string;
}

/**
 * Die Tabellenbreite aus den ÜBERGEBENEN Spalten (LFH-523) — rein und exportiert, damit die
 * Zusicherung ohne Rendern prüfbar ist (Muster `bedienzielStil`, `aktionsabstand`).
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────────────
 *
 * `scroll={{ x: 'max-content' }}` macht die Tabellenbreite inhaltsgetrieben. Eine Spalte
 * ohne `width` trägt dann ihre volle `max-content`-Breite bei, und ein normal umbrechbarer
 * Meldungstext bleibt EINZEILIG statt umzubrechen: im Handschuhmodus gemessen 1484 px Text
 * gegen 936 px Sicht, 1122 px innerer Überlauf bei 1280 px und 1036 px bei 1366 px. Der
 * Kartenzweig derselben Daten bricht denselben Text um — der Tabelle fehlte bloß der
 * Deckel, gegen den sie hätte umbrechen können.
 *
 * ── DIE RECHNUNG ────────────────────────────────────────────────────────────────
 *
 * Trägt genau EINE Spalte {@link KatalogSpalte.mindestBreite}, ist die Breite
 * `Σ(width der übrigen) + mindestBreite`. Antd behält daneben sein `min-width: 100%`; die
 * Tabelle füllt also weiter den Container und scrollt erst UNTERHALB dieser Zahl in sich.
 *
 * **Warum das die ≥50-%-Zusicherung aus LFH-342 · C7 nicht anfasst:** liegt die gerechnete
 * Zahl unter der Containerbreite, ist die BENUTZTE Breite in beiden Fassungen dieselbe
 * (`min-width: 100%` gewinnt gegen beide), und die `auto`-Layoutrechnung verteilt die
 * Spalten danach identisch. Auseinander gehen die zwei Fassungen erst, wenn `max-content`
 * den Container ÜBERSTEIGT — und das ist genau der Befund, nicht die Zusicherung.
 *
 * ── ZWEI ABBRÜCHE, BEIDE MIT GRUND STATT STILL ──────────────────────────────────
 *
 * · **Eine Nachbarspalte ohne Zahlbreite.** Dann wäre die Summe geraten, und ein geratener
 *   Deckel ist schlechter als keiner: er behauptete eine Breite, die die Spalte nicht hält.
 *   Erfasst ist auch die Zeichenkettenform (`width: '20%'`) und die Spaltengruppe, die gar
 *   keine Blattbreite hat.
 * · **Zwei Fließspalten.** Das sind kein Deckel, sondern zwei Reste — welche der beiden den
 *   Überschuss bekäme, entschiede die Layoutrechnung und nicht der Entwurf.
 *
 * In beiden Fällen bleibt es beim Bestandsverhalten, und der Grund geht als DEV-Warnung
 * heraus. Ein Opt-in, das still nichts tut, wäre von einem kaputten nicht zu unterscheiden.
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
 * Ref-gezählte, modulweite `/`-Bindung.
 *
 * Ein Zuhörer je Instanz wäre falsch: `pages/uhs/UhsDetailPage.tsx` rendert `Tabs` OHNE
 * `destroyOnHidden`, nach dem Besuch beider Reiter sind also zwei Tabellen gleichzeitig
 * montiert. Zwei Bindungen stritten dann um den Fokus, und wer gewinnt, hinge an der
 * Montagereihenfolge. Bei mehr als einer angemeldeten Instanz tut das Kürzel deshalb
 * NICHTS und warnt in DEV. Auf-/Abmelde-Bauform nach
 * `command-palette/CommandPaletteProvider.tsx`, der einzigen anderen globalen Bindung.
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
  // Der Ref hält die jeweils frische Fokusfunktion, damit der Effekt an `aktiv` allein
  // hängt: eine je Render neu gebaute Funktion in den Deps meldete den Zuhörer bei
  // JEDEM Render ab und wieder an — und die Zählung „genau eine Instanz" flackerte.
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
 * Lädt die Tabelle gerade? Bildet {@link https://github.com/ant-design/ant-design | antds}
 * `useSpinProps` nach: ein Objekt ohne `spinning` lädt, ein explizites `spinning: false`
 * nicht. Eine Prüfung auf `loading === true` verfehlte die Objektform still.
 */
function istLadend(loading: TableProps['loading']): boolean {
  if (typeof loading === 'boolean') return loading;
  if (loading == null) return false;
  return loading.spinning ?? true;
}

export default function KatalogTabelle<T extends object>({
  columns,
  dataSource,
  pagination,
  loading,
  locale,
  suche,
  ...rest
}: KatalogTabelleProps<T>) {
  const [suchbegriff, setSuchbegriff] = useState('');
  const feldRef = useRef<InputRef>(null);
  const werkzeugWurzel = useRef<HTMLDivElement>(null);
  useSlashKuerzel(suche != null, () => feldRef.current?.focus());
  useTastaturEbene({
    name: 'Katalogtabelle-Filter',
    wurzel: werkzeugWurzel,
    aktionen: { 'filter-zuruecksetzen': () => setSuchbegriff('') },
    aktiv: suche != null,
  });

  /**
   * Fixiert wird die ERSTE Spalte, nicht eine per Prop benannte: in allen Aufrufstellen
   * ist sie bereits die menschenlesbare Kennung, ein Pflicht-Prop wäre dort reine
   * Zeremonie und würde driften. Nicht angetastet wird sie, wenn der Aufrufer selbst eine
   * Seite gewählt hat oder wenn dort eine Spaltengruppe steht — eine Gruppe ist keine
   * Blattspalte, ihre Fixierung wäre wirkungslos.
   */
  const fixierteSpalten = useMemo(() => {
    const erste = columns?.[0];
    if (!columns || !erste || erste.fixed !== undefined || 'children' in erste) return columns;
    return [{ ...erste, fixed: 'left' as const }, ...columns.slice(1)];
  }, [columns]);

  /**
   * DIE EINE benannte Quelle der gerenderten Zeilen.
   *
   * Genau hier tauscht LFH-331/B3 die Herkunft (serverseitige Seite statt Vollmenge) —
   * die Signatur bleibt, `dataSource` bleibt `dataSource`. Bewusst NICHT `effektiveDaten`
   * genannt: derselbe Name in `Datensicht.tsx` bezeichnet eine größere Operation
   * (Filter + Suche + Gruppen + Sortierung), und zwei gleichnamige Funktionen mit
   * verschiedenem Vertrag in einem Verzeichnis sind eine Falle.
   */
  const sichtbareZeilen = useMemo(() => {
    const begriff = suchbegriff.trim().toLowerCase();
    if (begriff === '' || !dataSource) return dataSource;
    // `suchText` gewinnt über `dataIndex` — Begründung im Dateikopf. Eine Spalte ohne beides
    // (render-only, Gruppe) fällt hier heraus und trägt wie bisher nicht bei.
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
   * Die gedeckelte Tabellenbreite (LFH-523). Gerechnet wird über `fixierteSpalten`, also
   * über die Garnitur, die auch WIRKLICH gerendert wird — `Datensicht` hat `abBreite`-Spalten
   * da längst herausgefiltert, und ein Deckel aus einer Vollmenge wäre genau dort zu breit,
   * wo der Befund gemessen wurde.
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
   * Die Schwelle rechnet gegen die ÜBERGEBENE Menge, nicht gegen `sichtbareZeilen` —
   * Begründung im Dateikopf. `showSizeChanger` ist ausdrücklich `false`: rc-pagination
   * schaltet es bei `total > 50` von selbst ein, also genau ab der Zeilenzahl, ab der
   * geblättert wird, und schöbe damit das breiteste Element der Leiste in eine Fläche,
   * die bei 390 px gemessen wird.
   */
  /**
   * Ladend schlägt leer — D4, für alle Aufrufstellen an dieser einen Stelle.
   *
   * `emptyText: null` ist die Unterdrückung, nicht das Weglassen des Schlüssels: antd
   * bewertet `typeof locale?.emptyText !== 'undefined'`, ein fehlender Schlüssel fiele also
   * auf `renderEmpty` (Bild + „Keine Daten") zurück. Der Rest von `locale` bleibt stehen —
   * er trägt Filter- und Sortierbeschriftungen, die mit dem Ladezustand nichts zu tun haben.
   */
  const wirkendesLocale = istLadend(loading) ? { ...locale, emptyText: null } : locale;

  const blaetterung =
    pagination ??
    ((dataSource?.length ?? 0) > BLAETTER_SCHWELLE
      ? { pageSize: BLAETTER_SCHWELLE, showSizeChanger: false }
      : (false as const));

  return (
    <>
      {suche != null && (
        // Die Werkzeugzeile liegt AUSSERHALB von `.ant-table`: `katalogtabelle-schmal.spec.ts`
        // misst `scrollWidth` am Tabellenwurzelknoten gegen 390 px, eine Leiste darin zählte
        // in dieses Maß hinein und machte die Messung stumpf.
        <div ref={werkzeugWurzel} data-lfh="katalog-werkzeuge" style={{ marginBlockEnd: 8 }}>
          <Input.Search
            ref={feldRef}
            allowClear
            placeholder={suche.platzhalter}
            value={suchbegriff}
            onChange={(e) => setSuchbegriff(e.target.value)}
            // Kein `size`-Prop (E8): die Höhe kommt aus `controlHeight` und zieht mit der
            // Dichtestufe mit. Fluide Breite statt fester Zahl.
            style={{ width: '100%', maxWidth: 220 }}
          />
        </div>
      )}
      <Table<T>
        {...rest}
        columns={fixierteSpalten}
        dataSource={sichtbareZeilen}
        loading={loading}
        locale={wirkendesLocale}
        pagination={blaetterung}
        // `test/utils.tsx` montiert `ConfigProvider` OHNE Locale, die Produktion setzt
        // `deDE` — der Sortier-Tooltip wäre im Test englisch und in Produktion deutsch,
        // jede Textzusicherung darauf entweder falsch oder umgebungsabhängig. Am
        // Berührungsgerät trägt er ohnehin nichts.
        showSorterTooltip={false}
        scroll={{ x: scrollX }}
        /*
         * GEMESSEN an `@rc-component/table/es/Table.js`: das Layout wählt rc-table selbst —
         * `if (fixColumn) return mergedScrollX === 'max-content' ? 'auto' : 'fixed'`. Dieses
         * Primitiv fixiert Spalte 0 IMMER, `fixColumn` ist also gesetzt; eine Zahl statt
         * `'max-content'` kippte das Layout still auf `fixed`. Unter `fixed` ist eine
         * Spaltenbreite BINDEND statt bevorzugt — die 96 px der ETB-Aktionsspalte schnitten
         * den 72-px-Knopf der Handschuhstufe an, und die Mindestinhaltsbreite jeder anderen
         * Spalte gleich mit. `auto` ist zugleich das, was der Bestand schon fährt.
         *
         * Nur im Zahlfall gesetzt: bei `'max-content'` wählt rc-table ohnehin `auto`, und im
         * Sonderfall einer Spaltengruppe an Position 0 (dann fixiert das Primitiv nichts,
         * und `sticky` führt auf `fixed`) wäre ein hartes `auto` eine stille Änderung an
         * einer Tabelle, die von LFH-523 gar nicht handelt.
         */
        tableLayout={typeof scrollX === 'number' ? 'auto' : undefined}
        sticky
      />
    </>
  );
}
