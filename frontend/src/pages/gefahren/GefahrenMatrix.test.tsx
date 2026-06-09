import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import GefahrenMatrix from './GefahrenMatrix';
import type { GefahrBewertung } from '../../api/types';

const zelle = (over: Partial<GefahrBewertung>): GefahrBewertung => ({
  id: 1, gefahrengebiet_id: 7, gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch',
  beschreibung: null, gemeldet_von: null, aktualisiert_von: 1, erstellt_at: '', geaendert_at: '', ...over,
});

describe('GefahrenMatrix', () => {
  it('rendert 13 Zeilen × 5 Spalten', () => {
    renderMitProviders(<GefahrenMatrix matrix={[]} darfSchreiben pending={false} onSetzen={() => {}} />);
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Ertrinken')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Einsatzkräfte')[0]).toBeInTheDocument();
  });

  it('setzt eine Warnstufe und ruft onSetzen mit vollem Zell-Zustand', async () => {
    const onSetzen = vi.fn();
    renderMitProviders(<GefahrenMatrix matrix={[]} darfSchreiben pending={false} onSetzen={onSetzen} />);
    const zellen = screen.getAllByLabelText('Warnstufe brand × menschen');
    const combobox = zellen[0].querySelector('input[role="combobox"]') ?? zellen[0];
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByText('Hoch'));
    await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch', beschreibung: null, gemeldet_von: null,
    }));
  });

  it('graut ungültige Kombinationen aus', () => {
    renderMitProviders(<GefahrenMatrix matrix={[]} darfSchreiben pending={false} onSetzen={() => {}} />);
    const zellen = screen.getAllByLabelText('Warnstufe atemgifte × sachwerte');
    expect(zellen[0]).toHaveClass('ant-select-disabled');
  });

  it('behält beschreibung/gemeldet_von bei Warnstufen-Wechsel', async () => {
    const onSetzen = vi.fn();
    const matrix = [zelle({ warnstufe: 'hoch', beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW' })];
    renderMitProviders(<GefahrenMatrix matrix={matrix} darfSchreiben pending={false} onSetzen={onSetzen} />);
    const zellen = screen.getAllByLabelText('Warnstufe brand × menschen');
    const combobox = zellen[0].querySelector('input[role="combobox"]') ?? zellen[0];
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByText('Akut'));
    await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'akut', beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW',
    }));
  });
});
