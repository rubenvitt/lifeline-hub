import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import type { FreiesZeichenUpdate } from '../../api/types';
import FreiesZeichenPicker, { type FreiesZeichenPickerProps } from './FreiesZeichenPicker';

function render(wert: FreiesZeichenUpdate, onChange = vi.fn<FreiesZeichenPickerProps['onChange']>()) {
  renderMitProviders(<FreiesZeichenPicker wert={wert} onChange={onChange} />);
  return { onChange };
}

/** antd-Select über sein aria-Label öffnen (die Combobox-Selektor-Fläche anklicken). */
function oeffneSelect(label: string) {
  const sel = screen.getAllByLabelText(label)[0];
  fireEvent.mouseDown(sel.querySelector('.ant-select-selector') ?? sel);
}

// getByLabelText kann bei antd-Selects mehrfach matchen → über Anzahl testen (robust).
const sichtbar = (label: string) => screen.queryAllByLabelText(label).length > 0;

describe('FreiesZeichenPicker — Grundzeichen-Katalog', () => {
  it('bietet den vollen Grundzeichen-Katalog (Stichprobe, nicht das kuratierte Objekttyp-Set)', async () => {
    render({ grundzeichen: 'taktische-formation' });
    oeffneSelect('Grundzeichen');
    // „Kein Grundzeichen" (Index 0) und „Stelle, Einrichtung" sind NICHT im kuratierten
    // Objekttyp-Set (taktische-formation/kraftfahrzeug/person/befehlsstelle) → belegen den
    // vollen Katalog. Beide liegen im gerenderten rc-virtual-list-Fenster.
    expect(await screen.findByText('Kein Grundzeichen')).toBeInTheDocument();
    expect(screen.getByText('Stelle, Einrichtung')).toBeInTheDocument();
  });
});

describe('FreiesZeichenPicker — accepts-Gating der Overlays', () => {
  it('blendet nicht-akzeptierte Overlay-Selects aus („ohne" akzeptiert laut Katalog nur symbol)', () => {
    render({ grundzeichen: 'ohne' });
    expect(sichtbar('Symbol')).toBe(true);
    expect(sichtbar('Fachaufgabe')).toBe(false);
    expect(sichtbar('Organisation')).toBe(false);
    expect(sichtbar('Einheit')).toBe(false);
    expect(sichtbar('Funktion')).toBe(false);
  });

  it('zeigt Funktion nur für „person", nicht für „taktische-formation"', () => {
    const { rerender } = renderMitProviders(
      <FreiesZeichenPicker wert={{ grundzeichen: 'person' }} onChange={vi.fn()} />,
    );
    expect(sichtbar('Funktion')).toBe(true);
    expect(sichtbar('Fachaufgabe')).toBe(true);
    rerender(<FreiesZeichenPicker wert={{ grundzeichen: 'taktische-formation' }} onChange={vi.fn()} />);
    expect(sichtbar('Funktion')).toBe(false);
    expect(sichtbar('Einheit')).toBe(true);
  });
});

describe('FreiesZeichenPicker — onChange-Spec', () => {
  it('meldet die vollständige Spec bei einer Overlay-Auswahl', async () => {
    const { onChange } = render({ grundzeichen: 'taktische-formation', label: 'Zug 1' });
    oeffneSelect('Organisation');
    const opt = await screen.findAllByText('Feuerwehr');
    await userEvent.click(opt[opt.length - 1]);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ grundzeichen: 'taktische-formation', organisation: 'feuerwehr', label: 'Zug 1' }),
      ),
    );
  });

  it('strippt beim Grundzeichen-Wechsel die nicht mehr akzeptierten Overlays (→ null)', async () => {
    const { onChange } = render({
      grundzeichen: 'person',
      funktion: 'fuehrungskraft',
      fachaufgabe: 'brandbekaempfung',
      symbol: 'drehleiter',
    });
    oeffneSelect('Grundzeichen');
    const opt = await screen.findAllByText('Kein Grundzeichen');
    await userEvent.click(opt[opt.length - 1]);
    // „ohne" akzeptiert nur symbol → funktion + fachaufgabe werden gestrippt, symbol bleibt.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ grundzeichen: 'ohne', funktion: null, fachaufgabe: null, symbol: 'drehleiter' }),
      ),
    );
  });

  it('meldet Label-Änderungen (onBlur, Whole-Spec)', () => {
    const { onChange } = render({ grundzeichen: 'taktische-formation' });
    const input = screen.getByLabelText('Bezeichnung');
    fireEvent.change(input, { target: { value: 'EA Nord' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ grundzeichen: 'taktische-formation', label: 'EA Nord' }));
  });
});
