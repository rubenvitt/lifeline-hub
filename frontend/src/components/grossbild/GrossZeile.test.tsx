import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { farbenHell } from '../../theme/tokens';
import { grossMass } from './grossMass';
import { GrossZeile, GrossZeilen } from './GrossZeile';

describe('GrossZeile (LLH-1747, Spec `grossbild-ansicht`, „Lesbar aus der Entfernung“)', () => {
  it('stellt den Wert in die Spalte direkt neben die Bezeichnung', () => {
    render(
      <GrossZeilen beschriftung="Sichtung">
        <GrossZeile bezeichnung="SK I" wert={4} />
        <GrossZeile bezeichnung="SK II" wert={11} notiz="2 neu" />
      </GrossZeilen>,
    );
    const liste = screen.getByRole('list', { name: 'Sichtung' });
    // Zwei Spalten, die erste so breit wie die längste Bezeichnung: kein Rand dazwischen.
    expect(liste.style.gridTemplateColumns).toBe('repeat(1, minmax(0, max-content) minmax(0, 1fr))');
    const zeilen = screen.getAllByRole('listitem');
    expect(zeilen).toHaveLength(2);
    expect(zeilen[1]).toHaveTextContent('SK II112 neu');
    const wert = screen.getByText('11');
    expect(wert.style.textAlign).not.toBe('end');
  });

  it('legt viele Zeilen auf zwei Spaltenpaare', () => {
    render(
      <GrossZeilen beschriftung="Sichtung" spalten={2}>
        <GrossZeile bezeichnung="SK I" wert={4} />
      </GrossZeilen>,
    );
    expect(screen.getByRole('list').style.gridTemplateColumns).toBe(
      'repeat(2, minmax(0, max-content) minmax(0, 1fr))',
    );
  });

  it('zeigt eine Farbmarke nur zusammen mit dem Wort', () => {
    render(
      <GrossZeilen beschriftung="Gefahren">
        <GrossZeile
          bezeichnung="Hochwasser"
          marke={farbenHell.alarm}
          wert="hoch"
          art="wort"
          ton="alarm"
        />
      </GrossZeilen>,
    );
    const marke = document.querySelector('[data-lfh="gross-marke"]') as HTMLElement;
    expect(marke).toHaveAttribute('aria-hidden', 'true');
    expect(marke.style.background).not.toBe('');
    expect(screen.getByRole('listitem')).toHaveTextContent('Hochwasserhoch');
    expect(screen.getByText('hoch')).toHaveStyle({ color: farbenHell.alarmText });
  });

  it('setzt eine Zahl groß in Mono, ein Wort kleiner in Text', () => {
    render(
      <GrossZeilen beschriftung="x">
        <GrossZeile bezeichnung="SK I" wert={4} />
        <GrossZeile bezeichnung="Sturm" wert="mittel" art="wort" />
      </GrossZeilen>,
    );
    expect(screen.getByText('4').style.fontSize).toBe(grossMass(72));
    expect(screen.getByText('4').style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText('mittel').style.fontSize).toBe(grossMass(40));
  });

  it('führt nirgendwohin', () => {
    const { container } = render(
      <GrossZeilen beschriftung="x">
        <GrossZeile bezeichnung="SK I" wert={4} />
      </GrossZeilen>,
    );
    expect(container.querySelector('a, button')).toBeNull();
  });
});
