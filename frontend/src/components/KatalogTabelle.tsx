import { Input, Table, type InputRef, type TableProps } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';

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
 * Datenbezug. **Render-only-Spalten tragen NICHT bei** — der Zellinhalt entsteht erst beim
 * Rendern. Das ist eine Grenze, keine Lücke, und in `KatalogTabelle.test.tsx` steht sie
 * als negative Zusicherung. Wer Volltext über gerenderte Zellen braucht, nimmt
 * `Datensicht` mit seinem `suchText`-Haken je Spalte.
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
export type KatalogTabelleProps<T> = Omit<TableProps<T>, 'scroll' | 'sticky'> & {
  /**
   * Schaltet Werkzeugzeile und Freitextsuche ein. Ohne dieses Prop existiert beides nicht.
   * Die Suche greift Spalten mit auflösbarem `dataIndex` — siehe Dateikopf.
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
  useSlashKuerzel(suche != null, () => feldRef.current?.focus());

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
    const bezogene = (columns ?? []).filter((s) => !('children' in s) && 'dataIndex' in s);
    return dataSource.filter((zeile) =>
      bezogene.some((spalte) => {
        const wert = zellenWert(spalte, zeile);
        return wert != null && String(wert).toLowerCase().includes(begriff);
      }),
    );
  }, [dataSource, columns, suchbegriff]);

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
        <div data-lfh="katalog-werkzeuge" style={{ marginBlockEnd: 8 }}>
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
        scroll={{ x: 'max-content' }}
        sticky
      />
    </>
  );
}
