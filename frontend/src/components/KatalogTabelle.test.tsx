import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TableColumnsType, TableProps } from 'antd';
import { renderMitProviders } from '../test/utils';
import KatalogTabelle, { BLAETTER_SCHWELLE } from './KatalogTabelle';

interface Zeile {
  id: number;
  funkrufname: string;
  typ: string;
}

const ZEILEN: Zeile[] = [{ id: 1, funkrufname: 'Florian 1/44/1', typ: 'LF' }];

const SPALTEN: TableColumnsType<Zeile> = [
  { title: 'Funkrufname', dataIndex: 'funkrufname', key: 'funkrufname' },
  { title: 'Typ', dataIndex: 'typ', key: 'typ' },
  { title: 'Aktionen', key: 'aktionen', render: () => 'bearbeiten' },
];

/**
 * Alle DOM-Erwartungen sind am realen jsdom-Rendering von antd 6 / @rc-component/table
 * gemessen (Discovery-Lauf), nicht aus der Bibliotheksquelle abgeleitet:
 * - die stehende Kopfzeile erzeugt einen eigenen Kopf-Container `ant-table-sticky-holder`
 *   und zieht Kopf und Körper in ZWEI `<table>`-Elemente auseinander,
 * - die Fixierung einer Spalte wird intern von 'left' auf 'start' normalisiert, die
 *   Kopfzelle trägt daher `ant-table-cell-fix-start` (nicht `…-fix-left`),
 * - der waagerechte Scrollcontainer schlägt sich als `width: max-content` auf der
 *   Körper-`<table>` nieder — der billigste ehrliche Beleg, dass der Prop wirkt und
 *   nicht bloß durchgereicht wird.
 */
describe('KatalogTabelle', () => {
  it('trägt waagerechten Scrollcontainer, fixierte Kopfzeile und fixierte Identifierspalte', () => {
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZEILEN}
        pagination={false}
      />,
    );

    // (a) stehende Kopfzeile
    expect(container.querySelector('.ant-table-sticky-holder')).not.toBeNull();

    // (b) genau EINE fixierte Kopfzelle, und es ist die menschenlesbare erste Spalte
    const fixierte = container.querySelectorAll('th.ant-table-cell-fix-start');
    expect(fixierte).toHaveLength(1);
    expect(fixierte[0].textContent).toBe('Funkrufname');

    // (c) der waagerechte Scrollcontainer wirkt auf der Körper-Tabelle
    const koerper = container.querySelector<HTMLTableElement>('.ant-table-body table');
    expect(koerper).not.toBeNull();
    expect(koerper!.style.width).toBe('max-content');
  });

  it('reicht Bestandsprops durch und überschreibt eine gesetzte Fixierung nicht', () => {
    const leer = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={[]}
        pagination={false}
        locale={{ emptyText: 'Keine Fahrzeuge' }}
      />,
    );
    expect(leer.getByText('Keine Fahrzeuge')).toBeInTheDocument();
    expect(leer.container.querySelector('.ant-pagination')).toBeNull();
    leer.unmount();

    const laedt = renderMitProviders(
      <KatalogTabelle<Zeile> rowKey="id" columns={SPALTEN} dataSource={[]} loading />,
    );
    expect(laedt.container.querySelector('.ant-spin-spinning')).not.toBeNull();
    laedt.unmount();

    // eigene Fixierung der ersten Spalte bleibt stehen
    const eigen = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={[{ ...SPALTEN[0], fixed: 'right' }, ...SPALTEN.slice(1)]}
        dataSource={ZEILEN}
        pagination={false}
      />,
    );
    expect(eigen.container.querySelectorAll('th.ant-table-cell-fix-end')).toHaveLength(1);
    expect(eigen.container.querySelectorAll('th.ant-table-cell-fix-start')).toHaveLength(0);
    eigen.unmount();

    // eine Spaltengruppe an Position 0 wird nicht fixiert (rc-table verlangt dort
    // eine Blattspalte; eine stillschweigende Fixierung wäre wirkungslos oder kaputt)
    const gruppe = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={[{ title: 'Kennung', children: [SPALTEN[0]] }, ...SPALTEN.slice(1)]}
        dataSource={ZEILEN}
        pagination={false}
      />,
    );
    expect(gruppe.container.querySelectorAll('th.ant-table-cell-fix-start')).toHaveLength(0);
  });

  /**
   * Die Ladeunterdrückung des Leerknotens (LFH-331 · B3, D4). Sie lebt im Primitiv, nicht an
   * den Aufrufstellen — geprüft wird sie deshalb hier und nur hier.
   *
   * `dataSource={[]}` ist die tragende Wahl: bei FEHLENDER `dataSource` unterdrückt antd
   * schon selbst (`InternalTable.js`, `rawData === EMPTY_LIST`), ein Test darauf wäre auch
   * ohne unsere Stelle grün und bewiese nichts.
   */
  const LEERTEXT = 'Noch keine Fahrzeuge erfasst';

  const leereTabelle = (loading: TableProps<Zeile>['loading']) => (
    <KatalogTabelle<Zeile>
      rowKey="id"
      columns={SPALTEN}
      dataSource={[]}
      pagination={false}
      loading={loading}
      locale={{ emptyText: LEERTEXT }}
    />
  );

  it('unterdrückt den Leertext, solange geladen wird — boolesch wie als SpinProps', () => {
    // `{ tip: … }` ist der Fall, den eine Prüfung auf `loading === true` still durchließe:
    // antds `useSpinProps` macht daraus `{ spinning: true, tip: … }`.
    for (const ladend of [true, { spinning: true }, { tip: 'Lade …' }]) {
      const r = renderMitProviders(leereTabelle(ladend));
      expect(r.queryByText(LEERTEXT), `loading=${JSON.stringify(ladend)}`).toBeNull();
      expect(r.container.querySelector('.ant-spin-spinning')).not.toBeNull();
      r.unmount();
    }

    for (const ruhend of [undefined, false, { spinning: false }]) {
      const r = renderMitProviders(leereTabelle(ruhend));
      expect(r.queryByText(LEERTEXT), `loading=${JSON.stringify(ruhend)}`).not.toBeNull();
      r.unmount();
    }
  });

  it('der Leertext erscheint erst, wenn das Laden durch ist', () => {
    const { rerender, queryByText } = renderMitProviders(leereTabelle(true));
    expect(queryByText(LEERTEXT)).toBeNull();

    rerender(leereTabelle(false));
    expect(queryByText(LEERTEXT)).not.toBeNull();
  });

  it('pinnt antds Leerknoten-Vertrag: `emptyText: null` unterdrückt ohne Rückfall', () => {
    /**
     * Der Mechanismus der Unterdrückung ist antd-Verhalten, kein zugesicherter Vertrag:
     * `InternalTable.js` bewertet `typeof locale?.emptyText !== 'undefined'`, weshalb `null`
     * durchgeht und NICHT auf `renderEmpty` zurückfällt. Kippte ein antd-Bump das auf eine
     * `!= null`-Prüfung, stünde plötzlich wieder ein Leerknoten (`.ant-empty`, Bild +
     * „Keine Daten") hinter dem Spinner — lautlos, weil kein anderer Test darauf zeigt.
     *
     * Deshalb ohne `locale`: geprüft wird der Rückfallpfad selbst, nicht unser Leertext.
     */
    const ladend = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={[]}
        pagination={false}
        loading
      />,
    );
    expect(ladend.container.querySelector('.ant-empty')).toBeNull();
    ladend.unmount();

    // Gegenprobe: ohne Ladezustand rendert derselbe Aufruf antds Leerknoten — der Pin oben
    // misst also die Unterdrückung und nicht bloß eine Tabelle, die nie einen Leerknoten hat.
    const ruhend = renderMitProviders(
      <KatalogTabelle<Zeile> rowKey="id" columns={SPALTEN} dataSource={[]} pagination={false} />,
    );
    expect(ruhend.container.querySelector('.ant-empty')).not.toBeNull();
  });

  it('warnt in DEV, wenn die erste Spalte die DB-id trägt', () => {
    const spion = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const eigene = () => spion.mock.calls.filter((a) => String(a[0]).includes('[KatalogTabelle]'));

    const flach = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={[{ title: 'ID', dataIndex: 'id', key: 'id' }, ...SPALTEN.slice(1)]}
        dataSource={ZEILEN}
        pagination={false}
      />,
    );
    expect(eigene()).toHaveLength(1);
    flach.unmount();

    spion.mockClear();
    const verschachtelt = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={[{ title: 'ID', dataIndex: ['meta', 'id'], key: 'id' }, ...SPALTEN.slice(1)]}
        dataSource={ZEILEN}
        pagination={false}
      />,
    );
    expect(eigene()).toHaveLength(1);
    verschachtelt.unmount();

    spion.mockClear();
    renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZEILEN}
        pagination={false}
      />,
    );
    expect(eigene()).toHaveLength(0);
    spion.mockRestore();
  });
});

/**
 * Suche, Blätterung und die durchgereichten antd-Haken (LFH-330 · B2).
 *
 * Die Suche ist **opt-in**: `pages/SchaedenPage.tsx` trägt bereits ein eigenes
 * `Input.Search` mit anderer Semantik (Ort/Beschreibung), `etb/EtbTabelle.tsx` sucht
 * serverweit über ein 100-Zeilen-Fenster, und `Datensicht` bringt im Tabellenzweig sein
 * eigenes Feld mit. Default-AN erzeugte in allen drei Fällen ein zweites Suchfeld.
 */
describe('KatalogTabelle · Suche', () => {
  const ZWEI: Zeile[] = [
    { id: 1, funkrufname: 'Florian 1/44/1', typ: 'LF' },
    { id: 2, funkrufname: 'Rotkreuz 2/83/1', typ: 'GW-San' },
  ];

  it('ohne suche-Prop gibt es weder Feld noch Werkzeugzeile', () => {
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile> rowKey="id" columns={SPALTEN} dataSource={ZWEI} pagination={false} />,
    );
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.querySelector('[data-lfh="katalog-werkzeuge"]')).toBeNull();
  });

  it('mit suche-Prop filtert das Feld die Zeilen', async () => {
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZWEI}
        pagination={false}
        suche={{ platzhalter: 'Funkrufname, Typ' }}
      />,
    );
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(feld).not.toBeNull();
    expect(feld!.placeholder).toBe('Funkrufname, Typ');

    expect(screen.queryByText('Florian 1/44/1')).not.toBeNull();
    expect(screen.queryByText('Rotkreuz 2/83/1')).not.toBeNull();

    await userEvent.type(feld!, 'LF');
    expect(screen.queryByText('Florian 1/44/1')).not.toBeNull();
    expect(screen.queryByText('Rotkreuz 2/83/1')).toBeNull();
  });

  it('die Werkzeugzeile liegt AUSSERHALB des Tabellenrahmens', () => {
    // `katalogtabelle-schmal.spec.ts` misst `scrollWidth` am `.ant-table`-Wurzelknoten
    // gegen 390 px. Eine Leiste INNERHALB dieses Knotens zählte in das Maß hinein und
    // machte die Messung stumpf — die Zeile muss deshalb ein Geschwister sein.
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZWEI}
        pagination={false}
        suche={{ platzhalter: 'suchen' }}
      />,
    );
    const werkzeuge = container.querySelector('[data-lfh="katalog-werkzeuge"]');
    expect(werkzeuge).not.toBeNull();
    expect(werkzeuge!.closest('.ant-table')).toBeNull();
  });

  it('render-only-Spalten tragen NICHT zur Suche bei (die dokumentierte Grenze)', async () => {
    /**
     * Muster `stammdaten/FahrzeugeTab.tsx:40`: `{ title: 'Stärke', key: 'staerke', render }`
     * ohne `dataIndex`. Der Zellinhalt ist erst nach dem Rendern bekannt, die Suche läuft
     * über die Rohdaten — der Begriff „Sonderrecht" ist hier also unerreichbar. Diese
     * negative Zusicherung pinnt die Grenze, statt sie später zu entdecken.
     */
    const mitRenderOnly: TableColumnsType<Zeile> = [
      { title: 'Funkrufname', dataIndex: 'funkrufname', key: 'funkrufname' },
      { title: 'Merkmal', key: 'merkmal', render: () => 'Sonderrecht' },
    ];
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={mitRenderOnly}
        dataSource={ZWEI}
        pagination={false}
        suche={{ platzhalter: 'suchen' }}
      />,
    );
    expect(screen.getAllByText('Sonderrecht')).toHaveLength(2);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'Sonderrecht');
    expect(screen.queryByText('Florian 1/44/1')).toBeNull();
    expect(screen.queryByText('Rotkreuz 2/83/1')).toBeNull();
    expect(screen.queryAllByText('Sonderrecht')).toHaveLength(0);
  });

  it('gesucht wird nur in ANGEZEIGTEN Spalten, nicht über alle Datenfelder', async () => {
    /**
     * Die naheliegende falsche Bauform ist `Object.values(zeile).some(…)`. Sie fände auch
     * Felder, für die es gar keine Spalte gibt — der Benutzer sieht dann eine Zeile ohne
     * erkennbaren Grund im Ergebnis stehen. Gesucht wird deshalb je Spalte, nicht je Feld;
     * `typ` ist hier bewusst NICHT bespaltet.
     */
    const nurName: TableColumnsType<Zeile> = [
      { title: 'Funkrufname', dataIndex: 'funkrufname', key: 'funkrufname' },
    ];
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={nurName}
        dataSource={ZWEI}
        pagination={false}
        suche={{ platzhalter: 'suchen' }}
      />,
    );
    await userEvent.type(
      container.querySelector<HTMLInputElement>('input[type="search"]')!,
      'GW-San',
    );
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(0);
  });

  it('die Suche läuft den VOLLEN dataIndex-Pfad, nicht nur das letzte Glied', async () => {
    /**
     * `bezugsSchluessel` reduziert `['meta','id']` auf `'id'` — als Suchresolver läse es
     * `zeile['id']` statt `zeile.meta.id` und lieferte still den falschen Wert. Deshalb
     * hat die Suche ihren eigenen, pfadlaufenden Resolver.
     */
    interface Tief {
      id: number;
      meta: { kennung: string };
    }
    const spalten: TableColumnsType<Tief> = [
      { title: 'Kennung', dataIndex: ['meta', 'kennung'], key: 'kennung' },
    ];
    const daten: Tief[] = [
      { id: 1, meta: { kennung: 'ALPHA' } },
      { id: 2, meta: { kennung: 'BRAVO' } },
    ];
    const { container } = renderMitProviders(
      <KatalogTabelle<Tief>
        rowKey="id"
        columns={spalten}
        dataSource={daten}
        pagination={false}
        suche={{ platzhalter: 'suchen' }}
      />,
    );
    await userEvent.type(
      container.querySelector<HTMLInputElement>('input[type="search"]')!,
      'ALPHA',
    );
    expect(screen.queryByText('ALPHA')).not.toBeNull();
    expect(screen.queryByText('BRAVO')).toBeNull();
  });

  it('/ fokussiert das Suchfeld — aber nicht aus einem Eingabefeld heraus', () => {
    /**
     * `etb/schnellerfassungModell.ts` erkennt das Slash-Menü am TEXTINHALT der Textarea,
     * nicht an einer Tastenbindung, und `pages/EtbPage.tsx` rendert Schnellerfassung und
     * Tabelle auf derselben Seite. Ein globales `/` ohne Target-Prüfung fräße dort den
     * Slash der Schnellerfassung.
     */
    const { container } = renderMitProviders(
      <>
        <textarea data-testid="etb-eingabe" />
        <KatalogTabelle<Zeile>
          rowKey="id"
          columns={SPALTEN}
          dataSource={ZWEI}
          pagination={false}
          suche={{ platzhalter: 'suchen' }}
        />
      </>,
    );
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.activeElement).not.toBe(feld);

    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(feld);

    const textarea = screen.getByTestId('etb-eingabe');
    textarea.focus();
    fireEvent.keyDown(textarea, { key: '/' });
    expect(document.activeElement).toBe(textarea);
  });

  it('bei zwei montierten Instanzen greift das /-Kürzel gar nicht', () => {
    /**
     * `pages/uhs/UhsDetailPage.tsx:130` rendert `Tabs` OHNE `destroyOnHidden` — nach dem
     * Besuch beider Reiter sind zwei Tabellen gleichzeitig montiert. Zwei Kürzel, die um
     * denselben Fokus streiten, sind schlimmer als keins: der Fokus landete abhängig von
     * der Montagereihenfolge irgendwo.
     */
    const spion = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderMitProviders(
      <>
        <KatalogTabelle<Zeile>
          rowKey="id"
          columns={SPALTEN}
          dataSource={ZWEI}
          pagination={false}
          suche={{ platzhalter: 'erste' }}
        />
        <KatalogTabelle<Zeile>
          rowKey="id"
          columns={SPALTEN}
          dataSource={ZWEI}
          pagination={false}
          suche={{ platzhalter: 'zweite' }}
        />
      </>,
    );
    const felder = container.querySelectorAll<HTMLInputElement>('input[type="search"]');
    expect(felder).toHaveLength(2);

    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).not.toBe(felder[0]);
    expect(document.activeElement).not.toBe(felder[1]);
    expect(spion.mock.calls.filter((a) => String(a[0]).includes('[KatalogTabelle]'))).toHaveLength(
      1,
    );
    spion.mockRestore();
  });
});

describe('KatalogTabelle · Blätterung', () => {
  const vieleZeilen = (anzahl: number): Zeile[] =>
    Array.from({ length: anzahl }, (_, i) => ({
      id: i + 1,
      funkrufname: `Florian ${i + 1}`,
      typ: 'LF',
    }));

  it('unterhalb der Schwelle wird nicht geblättert', () => {
    // Antds Default ist `DEFAULT_PAGE_SIZE = 10` — ohne eigene Ableitung blätterten
    // 40 Zeilen bereits, und die Aufrufstellen bekämen eine Leiste, die sie nie wollten.
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile> rowKey="id" columns={SPALTEN} dataSource={vieleZeilen(40)} />,
    );
    expect(container.querySelector('.ant-pagination')).toBeNull();
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(40);
  });

  it('oberhalb der Schwelle wird geblättert, OHNE Größenumschalter', () => {
    // `@rc-component/pagination`: `showSizeChanger = total > totalBoundaryShowSizeChanger`
    // (Grenze 50). Genau ab der Zeilenzahl, ab der geblättert wird, erschiene also das
    // breiteste Element der Leiste von selbst — auf einer Route, die bei 390 px gemessen
    // wird. Deshalb explizit `false`.
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile> rowKey="id" columns={SPALTEN} dataSource={vieleZeilen(60)} />,
    );
    expect(container.querySelector('.ant-pagination')).not.toBeNull();
    expect(container.querySelector('.ant-pagination-options')).toBeNull();
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(BLAETTER_SCHWELLE);
  });

  it('ein übergebenes pagination={false} gewinnt auch über der Schwelle', () => {
    // Erweiterung des Bestandspins oben, der mit LEERER dataSource prüft und dort
    // strukturell nicht fallen kann. `??` statt `||`, damit `false` gewinnt.
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={vieleZeilen(60)}
        pagination={false}
      />,
    );
    expect(container.querySelector('.ant-pagination')).toBeNull();
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(60);
  });

  it('die Blätterleiste bleibt beim Suchen stehen (kein Layoutsprung)', async () => {
    /**
     * Die Schwelle rechnet gegen `dataSource.length`, NICHT gegen die gefilterte Menge —
     * sonst verschwände die Leiste beim Tippen unter 50 Treffer und erzeugte genau den
     * Sprung, gegen den Prüflisten-Kriterium 12 existiert. `hideOnSinglePage` ist aus
     * demselben Grund nicht der Mechanismus (es rechnet gegen die gerenderte Menge).
     */
    const daten = [...vieleZeilen(60), { id: 999, funkrufname: 'Rotkreuz Sonderfall', typ: 'GW' }];
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={daten}
        suche={{ platzhalter: 'suchen' }}
      />,
    );
    expect(container.querySelector('.ant-pagination')).not.toBeNull();

    await userEvent.type(
      container.querySelector<HTMLInputElement>('input[type="search"]')!,
      'Sonderfall',
    );
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(1);
    expect(container.querySelector('.ant-pagination')).not.toBeNull();
  });
});

describe('KatalogTabelle · durchgereichte Sortierung und Filter', () => {
  const ZWEI: Zeile[] = [
    { id: 1, funkrufname: 'Rotkreuz 2/83/1', typ: 'GW-San' },
    { id: 2, funkrufname: 'Florian 1/44/1', typ: 'LF' },
  ];
  const namen = (c: HTMLElement) =>
    [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

  it('sorter an einer Spalte sortiert die Zeilen', async () => {
    const spalten: TableColumnsType<Zeile> = [
      {
        title: 'Funkrufname',
        dataIndex: 'funkrufname',
        key: 'funkrufname',
        sorter: (a, b) => a.funkrufname.localeCompare(b.funkrufname),
      },
      { title: 'Typ', dataIndex: 'typ', key: 'typ' },
    ];
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile> rowKey="id" columns={spalten} dataSource={ZWEI} pagination={false} />,
    );
    expect(namen(container)).toEqual(['Rotkreuz 2/83/1', 'Florian 1/44/1']);

    // Der Auslöser sitzt in der Kopfzelle, die das Primitiv unbedingt fixiert
    // (`position: sticky` in einem `overflow: auto`-Container). jsdom rechnet dort kein
    // Layout — dass der Klick auch am 390-px-Schirm ankommt, ist hier NICHT belegt.
    const kopf = container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!;
    await userEvent.click(kopf);
    expect(namen(container)).toEqual(['Florian 1/44/1', 'Rotkreuz 2/83/1']);
  });

  it('filters MIT onFilter filtert, filters OHNE onFilter ist ein No-op', async () => {
    /**
     * Gemessen in `antd/es/table/hooks/useFilter/index.js`: die Filter-UI erscheint,
     * sobald `column.filters` gesetzt ist — gefiltert wird aber nur bei vorhandenem
     * `onFilter`. Ein Test, der den Trichter oder den Quelltext prüft, wäre grün, während
     * die Filterung nichts tut. Deshalb wird die ZEILENMENGE geprüft, in beiden Fällen.
     *
     * Die Menüknöpfe werden über die Klasse gegriffen, nicht über ihren Text: `test/utils`
     * montiert `ConfigProvider` OHNE Locale, die Produktion setzt `deDE` — „Reset"/„OK"
     * gegen „Zurücksetzen"/„OK" wäre eine umgebungsabhängige Zusicherung.
     */
    const basis = { title: 'Typ', dataIndex: 'typ' as const, key: 'typ' };
    const werte = [{ text: 'Löschfahrzeug', value: 'LF' }];

    const klickeFilter = async (container: HTMLElement) => {
      await userEvent.click(container.querySelector<HTMLElement>('.ant-table-filter-trigger')!);
      await userEvent.click(await screen.findByText('Löschfahrzeug'));
      await userEvent.click(
        document.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
      );
    };

    const mit = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={[
          { title: 'Funkrufname', dataIndex: 'funkrufname', key: 'funkrufname' },
          { ...basis, filters: werte, onFilter: (w, z) => z.typ === w },
        ]}
        dataSource={ZWEI}
        pagination={false}
      />,
    );
    expect(mit.container.querySelectorAll('tr.ant-table-row')).toHaveLength(2);
    await klickeFilter(mit.container);
    expect(mit.container.querySelectorAll('tr.ant-table-row')).toHaveLength(1);
    mit.unmount();

    const ohne = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={[
          { title: 'Funkrufname', dataIndex: 'funkrufname', key: 'funkrufname' },
          { ...basis, filters: werte },
        ]}
        dataSource={ZWEI}
        pagination={false}
      />,
    );
    expect(ohne.container.querySelector('.ant-table-filter-trigger')).not.toBeNull();
    await klickeFilter(ohne.container);
    expect(ohne.container.querySelectorAll('tr.ant-table-row')).toHaveLength(2);
  });
});
