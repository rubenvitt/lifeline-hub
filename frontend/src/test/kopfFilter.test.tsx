import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderMitProviders } from './utils';
import { setzeViewportBreite } from './viewport';
import { kopfFilterWaehlen, kopfFilterWerte } from './kopfFilter';
import Datensicht, { spaltenFuer } from '../components/Datensicht';

/**
 * Die Testhilfe wählt im Menü des Kopfs, den sie geöffnet hat (LLH-1431): ein geschlossenes Menü
 * trägt in jsdom nie `ant-dropdown-hidden`, ein zweiter Kopffilter im selben Test darf nicht im
 * Menü des ersten suchen.
 */

interface Zeile {
  id: number;
  ort: string;
  ausmass: 'gering' | 'gross';
  typ: 'sturm' | 'wasser';
}
const DATEN: Zeile[] = [
  { id: 1, ort: 'Deich', ausmass: 'gross', typ: 'wasser' },
  { id: 2, ort: 'Ufer', ausmass: 'gering', typ: 'wasser' },
  { id: 3, ort: 'Wald', ausmass: 'gross', typ: 'sturm' },
];
const spalten = spaltenFuer<Zeile>()([
  { key: 'ort', title: 'Ort', dataIndex: 'ort', immerSichtbar: true },
  {
    key: 'ausmass',
    title: 'Ausmaß',
    dataIndex: 'ausmass',
    filter: {
      werte: [
        { text: 'Gering', value: 'gering' },
        { text: 'Groß', value: 'gross' },
      ],
      trifft: (z, w) => z.ausmass === w,
    },
  },
  {
    key: 'typ',
    title: 'Typ',
    dataIndex: 'typ',
    filter: {
      werte: [
        { text: 'Sturm', value: 'sturm' },
        { text: 'Wasser', value: 'wasser' },
      ],
      trifft: (z, w) => z.typ === w,
    },
  },
]);
type Key = (typeof spalten)[number]['key'];

const zeilen = () =>
  [...document.querySelectorAll('tbody tr[data-row-key]')].map((z) =>
    z.getAttribute('data-row-key'),
  );

function rendere() {
  setzeViewportBreite(1366);
  return renderMitProviders(
    <Datensicht<Zeile, Key>
      bezeichnung="Schäden"
      spalten={spalten}
      daten={DATEN}
      zeilenSchluessel="id"
      karte={{ art: 'plan', titel: { spalte: 'ort' } }}
      mehrzahl="Schäden"
    />,
  );
}

describe('kopfFilterWaehlen · Menü des geöffneten Kopfs (LLH-1431)', () => {
  it('zwei Kopffilter nacheinander wählen jeweils im eigenen Menü', async () => {
    rendere();
    await kopfFilterWaehlen('Ausmaß', ['Groß (2)']);
    await waitFor(() => expect(zeilen()).toEqual(['1', '3']));
    await kopfFilterWaehlen('Typ', ['Sturm (1)']);
    await waitFor(() => expect(zeilen()).toEqual(['3']));
  });

  it('der erste Kopf lässt sich nach dem zweiten erneut öffnen und ändern', async () => {
    rendere();
    await kopfFilterWaehlen('Typ', ['Wasser (2)']);
    await waitFor(() => expect(zeilen()).toEqual(['1', '2']));
    await kopfFilterWaehlen('Ausmaß', ['Gering (1)']);
    await waitFor(() => expect(zeilen()).toEqual(['2']));
    // Zurück in den ersten Kopf: sein Menü liegt im DOM vor dem zweiten.
    await kopfFilterWaehlen('Typ', ['Sturm (0)']);
    await waitFor(() => expect(zeilen()).toEqual(['2']));
    // Die Zähler des zweiten Kopfs, unter Sturm und Wasser: alle drei Zeilen.
    expect(await kopfFilterWerte('Ausmaß')).toEqual(['Gering (1)', 'Groß (2)']);
  });
});
