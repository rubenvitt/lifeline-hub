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
          bewertung({ gefahrentyp: 'absturz', schutzobjekt: 'menschen', warnstufe: 'mittel' }),
          bewertung({ gefahrentyp: 'atemgifte', schutzobjekt: 'menschen', warnstufe: 'niedrig' }),
        ]}
      />,
    );

    const zeilenkoepfe = screen.getAllByRole('rowheader').map((k) => k.textContent);
    // Alphabetisch wie die Matrix (LLH-1102), nicht nach Katalog (Atemgifte vor Absturz) und
    // nicht in der Reihenfolge der Antwort.
    expect(zeilenkoepfe).toEqual(['Absturz', 'Atemgifte', 'Brand', 'Ertrinken']);
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

  /** LLH-1365: dieselbe Marke wie die Matrix, derselbe Namenszusatz. */
  describe('Erläuterungen (LLH-1365)', () => {
    it('erkennt eine Zelle mit Erläuterung an Marke und Name, eine ohne an keinem von beiden', () => {
      const { container } = renderMitProviders(
        <GefahrenMatrixAuszug
          matrix={[
            bewertung({
              gefahrentyp: 'elektrizitaet',
              schutzobjekt: 'menschen',
              warnstufe: 'mittel',
              beschreibung: 'Stromführende Kellerverteilungen unter Wasser.',
            }),
            bewertung({ gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch' }),
            // Leerraum allein ist keine Erläuterung (`hatErlaeuterung`).
            bewertung({
              gefahrentyp: 'brand',
              schutzobjekt: 'tiere',
              warnstufe: 'niedrig',
              beschreibung: '   ',
            }),
          ]}
        />,
      );

      const mit = screen.getByRole('cell', {
        name: 'Elektrizität × Menschen: mittel · mit Erläuterung',
      });
      expect(mit).toHaveTextContent('M');
      const marke = mit.querySelector<HTMLElement>('[data-lfh="erlaeuterung-marke"]');
      expect(marke, 'die Zelle trägt die Marke der Matrix').not.toBeNull();
      expect(marke).toHaveAttribute('aria-hidden', 'true');
      expect(marke!.style.borderBlockStart).toMatch(/currentcolor/i);
      // Die Marke sitzt in der Ecke der Zelle: die Zelle ist ihr Bezug.
      expect(mit.style.position).toBe('relative');

      const ohne = screen.getByRole('cell', { name: 'Brand × Menschen: hoch' });
      expect(ohne.querySelector('[data-lfh="erlaeuterung-marke"]')).toBeNull();
      expect(screen.getByRole('cell', { name: 'Brand × Tiere: niedrig' })).toBeInTheDocument();
      // Genau eine Zelle + das Zeichen der Legende.
      expect(container.querySelectorAll('[data-lfh="erlaeuterung-marke"]')).toHaveLength(2);
      expect(screen.getByText('mit Erläuterung')).toBeInTheDocument();
    });

    it('zeigt eine Gefahr, deren einzige Aussage eine Erläuterung zu „keine“ ist', () => {
      renderMitProviders(
        <GefahrenMatrixAuszug
          matrix={[
            bewertung({
              gefahrentyp: 'elektrizitaet',
              schutzobjekt: 'menschen',
              warnstufe: 'keine',
              beschreibung: 'Geprüft, kein Strom im Keller.',
            }),
          ]}
        />,
      );

      expect(screen.queryByText('Keine Gefahr über Stufe „keine“.')).toBeNull();
      expect(screen.getAllByRole('rowheader').map((k) => k.textContent)).toEqual(['Elektrizität']);
      expect(
        screen.getByRole('cell', { name: 'Elektrizität × Menschen: keine · mit Erläuterung' }),
      ).toHaveTextContent('–');
    });

    it('ohne Erläuterung keine Marke und kein Legendeneintrag', () => {
      const { container } = renderMitProviders(
        <GefahrenMatrixAuszug matrix={[bewertung({ warnstufe: 'hoch' })]} />,
      );
      expect(container.querySelector('[data-lfh="erlaeuterung-marke"]')).toBeNull();
      expect(screen.queryByText('mit Erläuterung')).toBeNull();
    });
  });

  it('liest nur: kein Knopf, kein Auswahlfeld', () => {
    renderMitProviders(<GefahrenMatrixAuszug matrix={[bewertung({ warnstufe: 'hoch' })]} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
