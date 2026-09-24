import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import type { GefahrBewertung } from '../../api/types';
import GefahrenMatrixAuszug from './GefahrenMatrixAuszug';

const bewertung = (o: Partial<GefahrBewertung>): GefahrBewertung =>
  ({
    id: 1,
    gefahrengebiet_id: 3,
    gefahrentyp: 'brand',
    schutzobjekt: 'menschen',
    warnstufe: 'keine',
    ...o,
  }) as GefahrBewertung;

describe('GefahrenMatrixAuszug (LFH-664, Entscheidung 5a)', () => {
  it('zeigt nur Gefahren mit mindestens einer Bewertung über „keine"', () => {
    renderMitProviders(
      <GefahrenMatrixAuszug
        matrix={[
          bewertung({ gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch' }),
          // Explosion trägt nur „keine" — die Zeile fällt weg.
          bewertung({ gefahrentyp: 'explosion', schutzobjekt: 'tiere', warnstufe: 'keine' }),
          bewertung({ gefahrentyp: 'ertrinken', schutzobjekt: 'tiere', warnstufe: 'niedrig' }),
        ]}
      />,
    );

    const zeilenkoepfe = screen.getAllByRole('rowheader').map((k) => k.textContent);
    // Katalogreihenfolge, nicht Reihenfolge der Antwort.
    expect(zeilenkoepfe).toEqual(['Brand', 'Ertrinken']);
    expect(screen.queryByText('Explosion')).not.toBeInTheDocument();
  });

  it('führt alle fünf Schutzobjekte als Spalten mit vollem Namen', () => {
    renderMitProviders(<GefahrenMatrixAuszug matrix={[bewertung({ warnstufe: 'mittel' })]} />);

    const koepfe = screen.getAllByRole('columnheader').map((k) => k.getAttribute('aria-label'));
    expect(koepfe).toEqual([null, 'Menschen', 'Tiere', 'Umwelt', 'Sachwerte', 'Einsatzkräfte']);
    expect(screen.getByRole('columnheader', { name: 'Einsatzkräfte' })).toHaveTextContent('Kraft');
  });

  it('nennt jede Zelle mit Kürzel und zugänglichem Namen, nicht allein über Farbe', () => {
    renderMitProviders(
      <GefahrenMatrixAuszug
        matrix={[
          bewertung({ schutzobjekt: 'menschen', warnstufe: 'akut' }),
          bewertung({ schutzobjekt: 'tiere', warnstufe: 'keine' }),
        ]}
      />,
    );

    const akut = screen.getByRole('cell', { name: 'Brand × Menschen: akut' });
    expect(akut).toHaveTextContent('A');
    expect(akut).toHaveAttribute('data-warnstufe', 'akut');
    // Ausdrücklich „keine" ist etwas anderes als gar nicht bewertet — im Text UND im Namen.
    expect(screen.getByRole('cell', { name: 'Brand × Tiere: keine' })).toHaveTextContent('–');
    const offen = screen.getByRole('cell', { name: 'Brand × Umwelt: nicht bewertet' });
    expect(offen).toHaveTextContent('');
  });

  it('trägt „n. a." an ungültigen Paaren', () => {
    renderMitProviders(
      <GefahrenMatrixAuszug
        matrix={[
          bewertung({ gefahrentyp: 'ertrinken', schutzobjekt: 'menschen', warnstufe: 'hoch' }),
        ]}
      />,
    );

    const zeile = screen.getByRole('row', { name: /Ertrinken/ });
    expect(within(zeile).getAllByText('n. a.')).toHaveLength(2);
    expect(
      within(zeile).getByRole('cell', { name: 'Ertrinken × Sachwerte: nicht anwendbar' }),
    ).toHaveTextContent('n. a.');
  });

  it('sagt „Keine Gefahren bewertet." statt einer leeren Tabelle', () => {
    renderMitProviders(<GefahrenMatrixAuszug matrix={[bewertung({ warnstufe: 'keine' })]} />);

    expect(screen.getByText('Keine Gefahren bewertet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('liest nur: kein Knopf, kein Auswahlfeld', () => {
    renderMitProviders(<GefahrenMatrixAuszug matrix={[bewertung({ warnstufe: 'hoch' })]} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
