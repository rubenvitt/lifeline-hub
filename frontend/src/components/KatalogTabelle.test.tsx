import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TableColumnsType, TableProps } from 'antd';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import KatalogTabelle, {
  BLAETTER_SCHWELLE,
  KOPF_FREIRAUM,
  fliessBreite,
  setzeKopfFreiraum,
  tabellenTokens,
  type KatalogSpalte,
} from './KatalogTabelle';
import { farbenDunkel, farbenHell } from '../theme/tokens';

function renderMitProviders(
  ui: ReactElement,
  options?: Parameters<typeof renderMitBasisProviders>[1],
) {
  const ergebnis = renderMitBasisProviders(
    <CommandPaletteProvider>{ui}</CommandPaletteProvider>,
    options,
  );
  const basisRerender = ergebnis.rerender;
  return {
    ...ergebnis,
    rerender: (naechstesUi: ReactElement) =>
      basisRerender(<CommandPaletteProvider>{naechstesUi}</CommandPaletteProvider>),
  };
}

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
 * Die DOM-Erwartungen folgen dem realen jsdom-Rendering von antd 6 / @rc-component/table:
 * - die stehende Kopfzeile erzeugt `ant-table-sticky-holder` und zieht Kopf und Körper in ZWEI
 *   `<table>`-Elemente auseinander,
 * - die Fixierung wird intern von 'left' auf 'start' normalisiert (`ant-table-cell-fix-start`),
 * - der Scrollcontainer schlägt sich als `width: max-content` auf der Körper-`<table>` nieder —
 *   der Beleg, dass der Prop wirkt und nicht bloß durchgereicht wird.
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

  /**
   * Druck (LFH-71): mit `sticky` legt rc-table den Kopf in eine EIGENE Tabelle, der Körper hat
   * dann kein `thead`, und die Kopfwiederholung greift nicht. Bei `beforeprint` rendert das
   * Primitiv deshalb ohne `sticky`, bei `afterprint` wieder mit. Synchron geprüft, ohne `act`:
   * der Browser friert das Druckbild direkt nach den Listenern ein.
   */
  it('legt im Druck Kopf und Körper in EINE Tabelle und stellt danach die stehende Kopfzeile wieder her', () => {
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZEILEN}
        pagination={false}
      />,
    );
    const koerperMitKopf = () =>
      Array.from(container.querySelectorAll('table')).some(
        (t) => t.querySelector('thead') !== null && t.querySelector('tbody tr') !== null,
      );
    // Vorbedingung: am Bildschirm steht der Kopf getrennt im Sticky-Halter.
    expect(container.querySelector('.ant-table-sticky-holder')).not.toBeNull();
    expect(koerperMitKopf()).toBe(false);

    window.dispatchEvent(new Event('beforeprint'));
    expect(container.querySelector('.ant-table-sticky-holder')).toBeNull();
    expect(koerperMitKopf()).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(container.querySelector('.ant-table-sticky-holder')).not.toBeNull();
    expect(koerperMitKopf()).toBe(false);
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

    // Eine Spaltengruppe an Position 0 wird nicht fixiert: rc-table verlangt dort eine Blattspalte.
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
   * Die Ladeunterdrückung des Leerknotens (LFH-331 · B3) lebt im Primitiv und wird nur hier
   * geprüft.
   *
   * `dataSource={[]}` ist die tragende Wahl: bei FEHLENDER `dataSource` unterdrückt antd schon
   * selbst, ein Test darauf bewiese nichts.
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
     * Die Unterdrückung ist antd-Verhalten, kein Vertrag: `InternalTable.js` prüft
     * `typeof locale?.emptyText !== 'undefined'`, `null` fällt also NICHT auf `renderEmpty` zurück.
     * Kippte ein antd-Bump das auf `!= null`, stünde lautlos wieder ein Leerknoten hinter dem
     * Spinner. Deshalb ohne `locale`: geprüft wird der Rückfallpfad selbst.
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

    // Gegenprobe: ohne Ladezustand rendert derselbe Aufruf antds Leerknoten — der Pin oben misst
    // also die Unterdrückung.
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
 * Die Suche ist **opt-in**: manche Seiten tragen eine eigene Suche mit anderer Semantik, und
 * `Datensicht` bringt ihr eigenes Feld mit. Default-AN erzeugte ein zweites Suchfeld.
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

  it('Strg/⌘ + Backspace im Suchwerkzeug leert den internen Suchzustand', async () => {
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZWEI}
        pagination={false}
        suche={{ platzhalter: 'Funkrufname, Typ' }}
      />,
    );
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'Rotkreuz');
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(1);

    const ereignis = new KeyboardEvent('keydown', {
      key: 'Backspace',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(feld, ereignis);

    expect(ereignis.defaultPrevented).toBe(true);
    expect(feld).toHaveValue('');
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(2);
  });

  it('umfasst mit seiner Shortcut-Wurzel keine Werkzeugknöpfe in Tabellenzellen', async () => {
    const spaltenMitAktion: TableColumnsType<Zeile> = [
      ...SPALTEN.slice(0, 2),
      {
        title: 'Aktionen',
        key: 'aktionen',
        render: () => <button type="button">Zeile bearbeiten</button>,
      },
    ];
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={spaltenMitAktion}
        dataSource={ZWEI}
        pagination={false}
        suche={{ platzhalter: 'Funkrufname, Typ' }}
      />,
    );
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'Rotkreuz');
    const aktion = screen.getAllByRole('button', { name: 'Zeile bearbeiten' })[0];
    aktion.focus();
    const ereignis = new KeyboardEvent('keydown', {
      key: 'Backspace',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(aktion, ereignis);

    expect(ereignis.defaultPrevented).toBe(false);
    expect(feld).toHaveValue('Rotkreuz');
  });

  it('die Werkzeugzeile liegt AUSSERHALB des Tabellenrahmens', () => {
    // `katalogtabelle-schmal.spec.ts` misst `scrollWidth` am `.ant-table`-Wurzelknoten; eine Leiste
    // INNERHALB zählte mit. Die Zeile muss deshalb ein Geschwister sein.
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
     * Spalte ohne `dataIndex` mit `render` (Muster `stammdaten/FahrzeugeTab.tsx`): die Suche läuft
     * über die Rohdaten, „Sonderrecht" ist hier unerreichbar. Gilt für Spalten OHNE `suchText`; erst
     * das Paar mit dem Fall darunter zeigt, dass der Haken der Unterschied ist.
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

  it('MIT suchText trägt dieselbe render-only-Spalte sehr wohl bei', async () => {
    /**
     * Die zweite Hälfte des Paares: gleiche Spalten, gleicher Begriff, nur `suchText` kommt dazu.
     * Ohne sie wäre die negative Zusicherung von einer kaputten Suche nicht zu unterscheiden.
     */
    const mitHaken: KatalogSpalte<Zeile>[] = [
      { title: 'Funkrufname', dataIndex: 'funkrufname', key: 'funkrufname' },
      {
        title: 'Merkmal',
        key: 'merkmal',
        render: (_wert: unknown, z: Zeile) => (z.id === 1 ? 'Sonderrecht' : 'ohne'),
        suchText: (z) => (z.id === 1 ? 'Sonderrecht' : 'ohne'),
      },
    ];
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={mitHaken}
        dataSource={ZWEI}
        pagination={false}
        suche={{ platzhalter: 'suchen' }}
      />,
    );
    await userEvent.type(
      container.querySelector<HTMLInputElement>('input[type="search"]')!,
      'Sonderrecht',
    );
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(1);
    expect(screen.queryByText('Florian 1/44/1')).not.toBeNull();
    expect(screen.queryByText('Rotkreuz 2/83/1')).toBeNull();
  });

  it('suchText GEWINNT über den dataIndex derselben Spalte, es summiert sich nicht', async () => {
    /**
     * Die Vorrangregel ist nur an einer Spalte prüfbar, deren Haken den Rohwert VERDECKT: `suchText`
     * liefert allein „Sonderrecht", der `dataIndex` trüge „Florian 1/44/1" bei. Ein Haken, der bloß
     * hinzuträte, ließe „Florian" weiter treffen.
     */
    const verdeckend: KatalogSpalte<Zeile>[] = [
      {
        title: 'Funkrufname',
        dataIndex: 'funkrufname',
        key: 'funkrufname',
        suchText: () => 'Sonderrecht',
      },
    ];
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={verdeckend}
        dataSource={ZWEI}
        pagination={false}
        suche={{ platzhalter: 'suchen' }}
      />,
    );
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'Florian');
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(0);

    // Gegenprobe: der Haken selbst trifft, sonst bewiese die Null oben nur eine leere Suche.
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Sonderrecht');
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(2);
  });

  it('gesucht wird nur in ANGEZEIGTEN Spalten, nicht über alle Datenfelder', async () => {
    /**
     * Gesucht wird je Spalte, nicht je Feld: `Object.values(zeile).some(…)` fände auch Felder ohne
     * Spalte, und die Zeile stünde ohne erkennbaren Grund im Ergebnis. `typ` ist hier bewusst NICHT
     * bespaltet.
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
     * `bezugsSchluessel` reduziert `['meta','id']` auf `'id'` und läse `zeile['id']` statt
     * `zeile.meta.id`. Deshalb hat die Suche ihren eigenen, pfadlaufenden Resolver.
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
     * Eine Schnellerfassung erkennt ihr Slash-Menü am TEXTINHALT eines Feldes auf derselben Seite.
     * Ein globales `/` ohne Target-Prüfung fräße dort den Slash.
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
     * Seiten mit `Tabs` ohne `destroyOnHidden` montieren zwei Tabellen gleichzeitig. Zwei Kürzel,
     * die um denselben Fokus streiten, sind schlimmer als keins.
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
    // Antds Default ist `DEFAULT_PAGE_SIZE = 10` — ohne eigene Ableitung blätterten schon 40 Zeilen.
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile> rowKey="id" columns={SPALTEN} dataSource={vieleZeilen(40)} />,
    );
    expect(container.querySelector('.ant-pagination')).toBeNull();
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(40);
  });

  it('oberhalb der Schwelle wird geblättert, OHNE Größenumschalter', () => {
    // `@rc-component/pagination` zeigt `showSizeChanger` ab 50 Zeilen von selbst — genau ab der
    // Blätterungsschwelle, auf einer Route, die bei 390 px gemessen wird. Deshalb explizit `false`.
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile> rowKey="id" columns={SPALTEN} dataSource={vieleZeilen(60)} />,
    );
    expect(container.querySelector('.ant-pagination')).not.toBeNull();
    expect(container.querySelector('.ant-pagination-options')).toBeNull();
    expect(container.querySelectorAll('tr.ant-table-row')).toHaveLength(BLAETTER_SCHWELLE);
  });

  it('ein übergebenes pagination={false} gewinnt auch über der Schwelle', () => {
    // Wie der Pin oben, aber mit Zeilen, sodass er fallen kann. `??` statt `||`, damit `false`
    // gewinnt.
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
     * Die Schwelle rechnet gegen `dataSource.length`, NICHT gegen die gefilterte Menge — sonst
     * verschwände die Leiste beim Tippen (Kriterium 12). `hideOnSinglePage` scheidet aus demselben
     * Grund aus.
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

    // Der Auslöser sitzt in der fixierten Kopfzelle. jsdom rechnet kein Layout — dass der Klick
    // am 390-px-Schirm ankommt, ist hier NICHT belegt.
    const kopf = container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!;
    await userEvent.click(kopf);
    expect(namen(container)).toEqual(['Florian 1/44/1', 'Rotkreuz 2/83/1']);
  });

  it('filters MIT onFilter filtert, filters OHNE onFilter ist ein No-op', async () => {
    /**
     * antd zeigt die Filter-UI, sobald `column.filters` gesetzt ist, gefiltert wird aber nur mit
     * `onFilter`. Deshalb wird die ZEILENMENGE geprüft, in beiden Fällen.
     *
     * Die Menüknöpfe werden über die Klasse gegriffen: `test/utils` montiert `ConfigProvider` OHNE
     * Locale, die Produktion setzt `deDE`.
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

/**
 * Die Fließspalte (LFH-523).
 *
 * BEFUND: `scroll={{ x: 'max-content' }}` macht die Tabellenbreite INHALTSGETRIEBEN; eine
 * Spalte ohne `width` trägt ihre volle `max-content`-Breite bei, ein langer Text bleibt
 * einzeilig und bläst die Tabelle auf.
 *
 * DECKELUNG: trägt genau EINE Spalte {@link KatalogSpalte.mindestBreite}, setzt das Primitiv
 * `Σ(width der übrigen) + mindestBreite` als `scroll.x`. `min-width: 100%` bleibt, die Tabelle
 * füllt also den Container und scrollt erst darunter.
 *
 * C7 BLEIBT UNBERÜHRT: liegt die Zahl unter der Containerbreite, ist die benutzte Breite in
 * beiden Fassungen dieselbe und die `auto`-Verteilung identisch.
 *
 * FALLE, wegen der `tableLayout` mitgesetzt wird: rc-table wählt
 * `if (fixColumn) return mergedScrollX === 'max-content' ? 'auto' : 'fixed'`. Spalte 0 ist
 * immer fixiert, eine Zahl kippte das Layout still auf `fixed` — dort ist eine Spaltenbreite
 * bindend, und eine 96-px-Aktionsspalte schnitte den 72-px-Knopf der Handschuhstufe an.
 */
describe('KatalogTabelle — Fließspalte (LFH-523)', () => {
  interface Lang {
    id: number;
    nr: string;
    inhalt: string;
  }

  const LANG: Lang[] = [{ id: 1, nr: '#1', inhalt: 'Keller unter Wasser' }];

  /** Nr. + Aktionen tragen feste Breiten, `inhalt` fließt. */
  const FLIESS: KatalogSpalte<Lang>[] = [
    { title: 'Nr.', dataIndex: 'nr', key: 'nr', width: 88 },
    { title: 'Inhalt', dataIndex: 'inhalt', key: 'inhalt', mindestBreite: 320 },
    { title: '', key: 'aktion', width: 96, render: () => 'x' },
  ];

  function koerperTabelle(container: HTMLElement): HTMLTableElement {
    const tabelle = container.querySelector<HTMLTableElement>('.ant-table-body table');
    expect(tabelle).not.toBeNull();
    return tabelle!;
  }

  it('deckelt die Tabellenbreite auf Summe der festen Breiten plus Mindestmaß', () => {
    const { container } = renderMitProviders(
      <KatalogTabelle<Lang> rowKey="id" columns={FLIESS} dataSource={LANG} pagination={false} />,
    );
    const tabelle = koerperTabelle(container);

    // 88 + 320 + 96, als Literal: zurückgerechnet prüfte die Zahl die Rechnung gegen sich selbst.
    expect(tabelle.style.width).toBe('504px');
    // Der Container bleibt die UNTERGRENZE, sonst fiele die C7-Zusicherung.
    expect(tabelle.style.minWidth).toBe('100%');
  });

  it('bleibt bei `auto`-Layout, obwohl rc-table auf eine Zahl hin `fixed` wählen würde', () => {
    const { container } = renderMitProviders(
      <KatalogTabelle<Lang> rowKey="id" columns={FLIESS} dataSource={LANG} pagination={false} />,
    );
    // Ohne das `tableLayout`-Prop im Primitiv stünde hier `fixed`.
    expect(koerperTabelle(container).style.tableLayout).toBe('auto');
  });

  it('rechnet über die ÜBERGEBENEN Spalten, nicht über eine gemerkte Garnitur', () => {
    // `Datensicht` filtert `abBreite`-Spalten HERAUS, bevor sie ankommen. Über die Vollmenge
    // gerechnet wäre der Deckel zu breit.
    const { container } = renderMitProviders(
      <KatalogTabelle<Lang>
        rowKey="id"
        columns={[FLIESS[0], FLIESS[1]]}
        dataSource={LANG}
        pagination={false}
      />,
    );
    expect(koerperTabelle(container).style.width).toBe('408px');
  });

  it('fällt ohne Fließspalte auf das inhaltsgetriebene Verhalten zurück', () => {
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile>
        rowKey="id"
        columns={SPALTEN}
        dataSource={ZEILEN}
        pagination={false}
      />,
    );
    const tabelle = koerperTabelle(container);
    expect(tabelle.style.width).toBe('max-content');
    // Das Layout bleibt unangetastet — der Opt-in ändert nichts an den Katalogen.
    expect(tabelle.style.tableLayout).toBe('auto');
  });

  it('hebt die Deckelung auf und warnt, wenn eine Nachbarspalte keine Zahlbreite hat', () => {
    const warnung = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderMitProviders(
      <KatalogTabelle<Lang>
        rowKey="id"
        // `aktion` ohne `width`: die Summe wäre geraten, und ein geratener Deckel ist schlechter als
        // keiner.
        columns={[FLIESS[0], FLIESS[1], { title: '', key: 'aktion', render: () => 'x' }]}
        dataSource={LANG}
        pagination={false}
      />,
    );
    expect(koerperTabelle(container).style.width).toBe('max-content');
    expect(warnung).toHaveBeenCalledWith(expect.stringContaining('aktion'));
    warnung.mockRestore();
  });

  it('hebt die Deckelung auf und warnt bei zwei Fließspalten', () => {
    const warnung = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderMitProviders(
      <KatalogTabelle<Lang>
        rowKey="id"
        columns={[FLIESS[0], FLIESS[1], { ...FLIESS[2], mindestBreite: 200 }]}
        dataSource={LANG}
        pagination={false}
      />,
    );
    // Zwei fließende Spalten sind zwei Reste; welche den Überschuss bekommt, entschiede die
    // Layoutrechnung.
    expect(koerperTabelle(container).style.width).toBe('max-content');
    expect(warnung).toHaveBeenCalledWith(expect.stringContaining('Fließspalte'));
    warnung.mockRestore();
  });
});

/**
 * Die Breitenrechnung für sich, rein und ohne Rendern. Die Rendertests darüber belegen die
 * VERDRAHTUNG, hier stehen die Zweige.
 */
describe('fliessBreite', () => {
  interface X {
    a: string;
  }

  it('gibt ohne Fließspalte das inhaltsgetriebene Maß und keinen Grund zurück', () => {
    const mass = fliessBreite<X>([{ key: 'a', width: 80 }, { key: 'b' }]);
    expect(mass).toEqual({ x: 'max-content' });
  });

  it('summiert Zahlbreiten und das Mindestmaß', () => {
    expect(
      fliessBreite<X>([
        { key: 'a', width: 80 },
        { key: 'b', mindestBreite: 320 },
        { key: 'c', width: 96 },
      ]),
    ).toEqual({ x: 496 });
  });

  it('verweigert die Rechnung bei einer Breite in Zeichenkettenform', () => {
    // `width: '20%'` ist relativ zur Tabelle, die gerade ausgerechnet wird — zirkulär. Antds Typ
    // lässt die Form zu, die Rechnung fängt sie ab.
    const mass = fliessBreite<X>([
      { key: 'a', width: '20%' },
      { key: 'b', mindestBreite: 320 },
    ]);
    expect(mass.x).toBe('max-content');
    expect(mass.warnung).toContain('a');
  });

  it('verweigert die Rechnung bei einer Spaltengruppe', () => {
    // Eine Gruppe hat keine eigene Blattbreite; sie mitzuzählen hieße, eine Zahl zu erfinden.
    const mass = fliessBreite<X>([
      { key: 'g', children: [{ key: 'a', width: 80 }] } as unknown as KatalogSpalte<X>,
      { key: 'b', mindestBreite: 320 },
    ]);
    expect(mass.x).toBe('max-content');
    expect(mass.warnung).toContain('g');
  });

  it('nennt bei zwei Fließspalten BEIDE Schlüssel', () => {
    // Ein Grund, der nur eine der beiden nennt, schickte den Leser auf die falsche Zeile.
    const mass = fliessBreite<X>([
      { key: 'a', mindestBreite: 100 },
      { key: 'b', mindestBreite: 200 },
    ]);
    expect(mass.x).toBe('max-content');
    expect(mass.warnung).toContain('a');
    expect(mass.warnung).toContain('b');
  });

  it('kommt mit fehlender Spaltenliste zurecht', () => {
    // `columns` ist an antd optional, und `KatalogTabelle` reicht es ungeprüft weiter.
    expect(fliessBreite<X>(undefined)).toEqual({ x: 'max-content' });
  });
});

/**
 * Freiraum unter der stehenden Kopfzeile (LFH-677, WCAG 2.4.11). Die WIRKUNG misst nur der
 * Browser (`e2e/betreuung-pruefliste.spec.ts`). Hier stehen die zwei Hälften ohne Layout: die
 * Höhe kommt aus der stehenden Kopfzeile, und die Regel, die sie liest, steht in der
 * Gestaltungssprache.
 */
describe('KatalogTabelle — Freiraum unter der stehenden Kopfzeile', () => {
  it('setzt die Variable auf die Höhe der stehenden Kopfzeile', () => {
    const wurzel = document.createElement('div');
    const kopf = document.createElement('div');
    kopf.className = 'ant-table-header ant-table-sticky-holder';
    Object.defineProperty(kopf, 'offsetHeight', { value: 39 });
    wurzel.appendChild(kopf);
    setzeKopfFreiraum(wurzel);
    expect(wurzel.style.getPropertyValue(KOPF_FREIRAUM)).toBe('39px');
  });

  it('ohne stehende Kopfzeile ist der Freiraum 0, nicht ein alter Wert', () => {
    const wurzel = document.createElement('div');
    wurzel.style.setProperty(KOPF_FREIRAUM, '39px');
    setzeKopfFreiraum(wurzel);
    expect(wurzel.style.getPropertyValue(KOPF_FREIRAUM)).toBe('0px');
  });

  it('die gerenderte Tabelle trägt die Variable an ihrer Wurzel', () => {
    const { container } = renderMitProviders(
      <KatalogTabelle<Zeile> rowKey="id" columns={SPALTEN} dataSource={ZEILEN} />,
    );
    const wurzel = container.querySelector<HTMLElement>('.ant-table-wrapper.lfh-katalog');
    expect(wurzel).not.toBeNull();
    // jsdom misst 0 — belegt ist, dass der Effekt die Wurzel erreicht, nicht die Zahl.
    expect(wurzel!.style.getPropertyValue(KOPF_FREIRAUM)).toBe('0px');
  });

  it('die Regel in der Gestaltungssprache liest die Variable an JEDEM Ziel im Tabellenkörper', () => {
    // `scroll-margin` wirkt am Element, das in die Sicht gerollt wird — am Fokusziel selbst.
    // Deshalb `*` unter `.ant-table-tbody`.
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'theme', 'sprache.css'),
      'utf8',
    );
    expect(css).toMatch(
      /\.ant-table-wrapper\.lfh-katalog \.ant-table-tbody \*\s*\{[^}]*scroll-margin-top:\s*var\(--lfh-tabellenkopf-hoehe/,
    );
  });
});

describe('tabellenTokens — Kopftext (LFH-652)', () => {
  const polster = { paddingSM: 7, padding: 11 };

  it('der Kopftext liest gedaempft, nicht schwach: am Tag hielte schwach auf kopf nur 5,58', () => {
    expect(tabellenTokens(farbenHell, false, polster).headerColor).toBe(farbenHell.gedaempft);
    expect(tabellenTokens(farbenDunkel, true, polster).headerColor).toBe(farbenDunkel.gedaempft);
  });
});
