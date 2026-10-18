import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Sichtungskategorie } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { sichtungsflaechen } from '../theme/tokens';
import SichtungsWahl, { sichtungsFlaecheStil, sichtungsLuecke } from './SichtungsWahl';

/** Ein kontrollierter Rahmen wie im `Form.Item`: der Wert lebt außen. */
function Gesteuert({
  start = null,
  abwaehlbar,
  onChange,
}: {
  start?: Sichtungskategorie | null;
  abwaehlbar?: boolean;
  onChange?: (k: Sichtungskategorie | null) => void;
}) {
  const [wert, setWert] = useState<Sichtungskategorie | null>(start);
  return (
    <SichtungsWahl
      value={wert}
      abwaehlbar={abwaehlbar}
      onChange={(k) => {
        setWert(k);
        onChange?.(k);
      }}
    />
  );
}

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

describe('SichtungsWahl — Flächen (LLH-1083)', () => {
  it('zeigt sechs benannte Optionen in der Dringlichkeitsfolge mit Kürzel und Wort', () => {
    renderMitProviders(<Gesteuert />);
    const gruppe = screen.getByRole('radiogroup', { name: 'Sichtungskategorie' });
    const flaechen = within(gruppe).getAllByRole('radio');
    expect(flaechen.map((f) => f.textContent)).toEqual([
      'SK Iakut',
      'SK IIschwer',
      'SK IIIleicht',
      'SK IVabwartend',
      'totverstorben',
      'unverletztohne Verletzung',
    ]);
  });

  it('füllt vor der Wahl jede Farbkategorie mit ihrer Flächenfarbe, unverletzt bleibt ohne', () => {
    renderMitProviders(<Gesteuert />);
    const sk1 = screen.getByRole('radio', { name: /^SK I,/ });
    expect(sk1.style.background).toBe(rgb(sichtungsflaechen.rot.flaeche));
    expect(sk1.style.color).toBe(rgb(sichtungsflaechen.rot.schrift));
    const ohne = screen.getByRole('radio', { name: /^unverletzt,/ });
    const farben = Object.values(sichtungsflaechen).map((f) => rgb(f.flaeche));
    expect(farben).not.toContain(ohne.style.background);
  });
});

describe('SichtungsWahl — Wahl und Zustand', () => {
  it('markiert die gewählte Fläche mit aria-checked, ✓ und kräftigem Rahmen; die übrigen treten zurück', async () => {
    renderMitProviders(<Gesteuert />);
    await userEvent.click(screen.getByRole('radio', { name: /^SK II,/ }));
    const sk2 = screen.getByRole('radio', { name: /^SK II,/ });
    expect(sk2).toHaveAttribute('aria-checked', 'true');
    expect(sk2.textContent).toContain('✓');
    expect(sk2.style.borderTopWidth).toBe('3px');
    expect(sk2.style.background).toBe(rgb(sichtungsflaechen.gelb.flaeche));
    const sk1 = screen.getByRole('radio', { name: /^SK I,/ });
    expect(sk1).toHaveAttribute('aria-checked', 'false');
    // Randform: nicht mehr gefüllt, Farbe nur als Streifen.
    expect(sk1.style.background).not.toBe(rgb(sichtungsflaechen.rot.flaeche));
    expect(sk1.style.borderInlineStart).toContain('8px');
    expect(sk1).toBeEnabled();
  });

  it('nimmt die Wahl mit abwaehlbar beim zweiten Tipp zurück', async () => {
    const onChange = vi.fn();
    renderMitProviders(<Gesteuert abwaehlbar onChange={onChange} />);
    const sk3 = screen.getByRole('radio', { name: /^SK III,/ });
    await userEvent.click(sk3);
    await userEvent.click(sk3);
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(sk3).toHaveAttribute('aria-checked', 'false');
  });

  it('bleibt ohne abwaehlbar bei der Wahl', async () => {
    const onChange = vi.fn();
    renderMitProviders(<Gesteuert onChange={onChange} />);
    const sk3 = screen.getByRole('radio', { name: /^SK III,/ });
    await userEvent.click(sk3);
    await userEvent.click(sk3);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(sk3).toHaveAttribute('aria-checked', 'true');
  });

  it('wechselt mit Pfeiltasten und wählt mit Leertaste', async () => {
    renderMitProviders(<Gesteuert />);
    const sk1 = screen.getByRole('radio', { name: /^SK I,/ });
    sk1.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight} ');
    expect(screen.getByRole('radio', { name: /^SK III,/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('hat genau einen Tab-Stopp', () => {
    renderMitProviders(<Gesteuert start="sk4" />);
    const stopps = screen.getAllByRole('radio').filter((r) => r.tabIndex === 0);
    expect(stopps).toHaveLength(1);
    expect(stopps[0]).toHaveAccessibleName(/^SK IV,/);
  });

  it('meldet gesperrt keine Wahl', async () => {
    const onChange = vi.fn();
    renderMitProviders(<SichtungsWahl disabled onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: /^SK I,/ }), {
      pointerEventsCheck: 0,
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('sichtungsFlaecheStil()/sichtungsLuecke() — Trefferfläche je Dichte', () => {
  it('hält 72 × 96 in jeder Stufe', () => {
    for (const controlHeight of [30, 48, 72]) {
      const stil = sichtungsFlaecheStil({ controlHeight, paddingXS: 8 });
      expect(stil.minHeight).toBeGreaterThanOrEqual(72);
      expect(stil.minWidth).toBeGreaterThanOrEqual(96);
    }
  });

  it('wächst über 72 mit einer größeren Steuerhöhe', () => {
    expect(sichtungsFlaecheStil({ controlHeight: 80, paddingXS: 8 }).minHeight).toBe(80);
  });

  it('lässt 8 px in kompakt und 16 px in den Berührungsstufen', () => {
    expect(sichtungsLuecke({ controlHeight: 30 })).toBe(8);
    expect(sichtungsLuecke({ controlHeight: 48 })).toBe(16);
    expect(sichtungsLuecke({ controlHeight: 72 })).toBe(16);
  });
});
