import { describe, expect, it, vi } from 'vitest';
import type { TableColumnsType } from 'antd';
import { renderMitProviders } from '../test/utils';
import KatalogTabelle from './KatalogTabelle';

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
