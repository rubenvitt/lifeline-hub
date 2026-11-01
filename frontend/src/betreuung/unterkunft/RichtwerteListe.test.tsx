import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { richtwerteAntwort } from '../../test/unterkunftRichtwerte';
import RichtwerteListe from './RichtwerteListe';

/** Richtwerte des Unterkunftsrechners je Ebene (LLH-1520, design.md D2). */

const zeile = (schluessel: string) =>
  document.querySelector<HTMLElement>(`[data-schluessel="${schluessel}"]`)!;

describe('RichtwerteListe', () => {
  it('Anzeige: wirksamer Wert mit Herkunft und Vorgabe, gruppiert wie das Ergebnis', () => {
    renderMitProviders(
      <RichtwerteListe
        ebenen={richtwerteAntwort({ flaeche_je_person_m2: 5 }, { wasser_je_person_l: 15 })}
        ebene="anzeige"
      />,
    );
    for (const titel of ['Schlafen', 'Sanitär', 'Gesundheit', 'Ver- und Entsorgung', 'Zelte']) {
      expect(screen.getByRole('region', { name: titel })).toBeInTheDocument();
    }
    expect(zeile('flaeche_je_person_m2')).toHaveTextContent('5 m²');
    expect(zeile('flaeche_je_person_m2')).toHaveTextContent('Organisation · 4 m² (Vorgabe)');
    expect(zeile('wasser_je_person_l')).toHaveTextContent('Einsatz · 25 l (Vorgabe)');
    expect(zeile('dusche_je_personen')).toHaveTextContent('Vorgabe');
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('Einsatz: leeres Feld zeigt den Wert der Organisation; Verlassen speichert, Leeren erbt wieder', async () => {
    const onSetzen = vi.fn();
    const { rerender } = renderMitProviders(
      <RichtwerteListe
        ebenen={richtwerteAntwort({ flaeche_je_person_m2: 5 })}
        ebene="einsatz"
        onSetzen={onSetzen}
      />,
    );
    const feld = screen.getByRole('spinbutton', { name: 'Schlaffläche je Person (m²)' });
    expect(feld).toHaveValue('');
    expect(feld).toHaveAttribute('placeholder', '5 m²');
    expect(zeile('flaeche_je_person_m2')).toHaveTextContent('Vorgabe der Organisation: 5 m²');

    await userEvent.type(feld, '6');
    await userEvent.tab();
    expect(onSetzen).toHaveBeenLastCalledWith('flaeche_je_person_m2', 6);

    rerender(
      <RichtwerteListe
        ebenen={richtwerteAntwort({ flaeche_je_person_m2: 5 }, { flaeche_je_person_m2: 6 })}
        ebene="einsatz"
        onSetzen={onSetzen}
      />,
    );
    await userEvent.clear(feld);
    await userEvent.tab();
    expect(onSetzen).toHaveBeenLastCalledWith('flaeche_je_person_m2', null);
    expect(onSetzen).toHaveBeenCalledTimes(2);
  });

  it('Organisation: Platzhalter ist die Vorgabe; unverändertes Verlassen speichert nicht', async () => {
    const onSetzen = vi.fn();
    renderMitProviders(
      <RichtwerteListe ebenen={richtwerteAntwort()} ebene="org" onSetzen={onSetzen} />,
    );
    const feld = screen.getByRole('spinbutton', { name: 'Personen je Dusche (Personen)' });
    expect(feld).toHaveAttribute('placeholder', '20 Personen (Vorgabe)');
    await userEvent.click(feld);
    await userEvent.tab();
    expect(onSetzen).not.toHaveBeenCalled();
  });

  it('gesperrt: alle Felder ausgegraut', () => {
    renderMitProviders(<RichtwerteListe ebenen={richtwerteAntwort()} ebene="org" gesperrt />);
    for (const f of screen.getAllByRole('spinbutton')) expect(f).toBeDisabled();
  });
});
