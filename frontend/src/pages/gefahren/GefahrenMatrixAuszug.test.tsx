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
    // Ausdrücklich „keine“ und gar nicht bewertet sind dieselbe Aussage (LLH-1090): „–“.
    expect(screen.getByRole('cell', { name: 'Brand × Tiere: keine' })).toHaveTextContent('–');
    const vorgabe = screen.getByRole('cell', { name: 'Brand × Umwelt: keine' });
    expect(vorgabe).toHaveTextContent('–');
    expect(vorgabe).toHaveAttribute('data-warnstufe', 'keine');
    expect(screen.queryByRole('cell', { name: /nicht bewertet$/ })).toBeNull();
  });

  it('schraffiert ungültige Paare ohne Text und nennt sie „nicht anwendbar“', () => {
    renderMitProviders(
      <GefahrenMatrixAuszug
        matrix={[
          bewertung({ gefahrentyp: 'ertrinken', schutzobjekt: 'menschen', warnstufe: 'hoch' }),
        ]}
      />,
    );

    const zeile = screen.getByRole('row', { name: /Ertrinken/ });
    expect(within(zeile).queryByText('n. a.')).toBeNull();
    const kacheln = within(zeile).getAllByRole('img', { name: /: nicht anwendbar$/ });
    expect(kacheln).toHaveLength(2);
    const sache = within(zeile).getByRole('img', {
      name: 'Ertrinken × Sachwerte: nicht anwendbar',
    });
    expect(sache).toHaveTextContent('');
    expect(sache.style.backgroundImage).toMatch(/^repeating-linear-gradient\(/);
  });

  it('sagt ohne Gefahr über „keine“ einen Satz statt einer leeren Tabelle', () => {
    for (const matrix of [[], [bewertung({ warnstufe: 'keine' })]]) {
      const { unmount } = renderMitProviders(<GefahrenMatrixAuszug matrix={matrix} />);
      expect(screen.getByText('Keine Gefahr über Stufe „keine“.')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('liest nur: kein Knopf, kein Auswahlfeld', () => {
    renderMitProviders(<GefahrenMatrixAuszug matrix={[bewertung({ warnstufe: 'hoch' })]} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
