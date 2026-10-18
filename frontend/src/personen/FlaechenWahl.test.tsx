import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import FlaechenWahl, { flaecheStil, flaechenLuecke } from './FlaechenWahl';

/** Die Flächenwahl (Change `y18v58dt-pat-kern`): Böden als Literale, Rollen, Tastatur. */

const OPTIONEN = [
  { wert: 'a', label: 'Blutstillung' },
  { wert: 'b', label: 'Zugang' },
  { wert: 'c', label: 'Infusion' },
] as const;

describe('flaecheStil — Boden je Stufe', () => {
  it.each([
    [30, 48],
    [48, 48],
    [72, 72],
  ])('Steuerhöhe %i → mindestens %i px hoch', (controlHeight, boden) => {
    expect(flaecheStil({ controlHeight, paddingXS: 4, paddingSM: 8 }).minHeight).toBe(boden);
  });

  it('hält 8 px Lücke in kompakt, 16 px in den Berührungsstufen', () => {
    expect(flaechenLuecke({ controlHeight: 30 })).toBe(8);
    expect(flaechenLuecke({ controlHeight: 48 })).toBe(16);
    expect(flaechenLuecke({ controlHeight: 72 })).toBe(16);
  });
});

describe('FlaechenWahl', () => {
  function zeige(value: 'a' | 'b' | 'c' | null = null) {
    const onChange = vi.fn();
    render(
      <ConfigProvider>
        <FlaechenWahl optionen={OPTIONEN} value={value} onChange={onChange} aria-label="Maßnahme" />
      </ConfigProvider>,
    );
    return onChange;
  }

  it('ist eine Radiogruppe, die gewählte Fläche trägt ✓', () => {
    zeige('b');
    const gewaehlt = screen.getByRole('radio', { name: 'Zugang' });
    expect(gewaehlt).toHaveAttribute('aria-checked', 'true');
    expect(gewaehlt.textContent).toBe('✓ Zugang');
    expect(gewaehlt).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Blutstillung' })).toHaveAttribute('tabindex', '-1');
  });

  it('wählt per Tipp und wandert mit den Pfeilen', async () => {
    const onChange = zeige();
    const [erste, zweite] = screen.getAllByRole('radio');
    erste.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(zweite);
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
    await userEvent.click(screen.getByRole('radio', { name: 'Infusion' }));
    expect(onChange).toHaveBeenLastCalledWith('c');
  });
});
