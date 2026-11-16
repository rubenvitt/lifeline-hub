import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { farbenHell } from '../../theme/tokens';
import { grossMass } from './grossMass';
import GrossKennzahl from './GrossKennzahl';

function zelle() {
  return document.querySelector('[data-lfh="gross-kennzahl"]') as HTMLElement;
}

describe('GrossKennzahl (LLH-1747, Spec `grossbild-ansicht`)', () => {
  it('zeigt Bezeichnung, Zahl und Notiz', () => {
    render(<GrossKennzahl titel="Betroffene" wert={248} notiz="· 2 ohne Sichtung" />);
    expect(screen.getByText('Betroffene')).toBeInTheDocument();
    expect(screen.getByText('248')).toBeInTheDocument();
    expect(screen.getByText('· 2 ohne Sichtung')).toBeInTheDocument();
  });

  it('setzt die Zahl in Mono mit festen Ziffern und Großbild-Maß', () => {
    render(<GrossKennzahl titel="Betroffene" wert={248} />);
    const zahl = screen.getByText('248');
    expect(zahl.style.fontVariantNumeric).toBe('tabular-nums');
    expect(zahl.style.fontSize).toBe(grossMass(96));
  });

  it('kennt die kleine Zahl', () => {
    render(<GrossKennzahl titel="Kräfte" wert="0/12/58//70" groesse="zahlKlein" />);
    expect(screen.getByText('0/12/58//70').style.fontSize).toBe(grossMass(72));
  });

  it('färbt Zahl und Notiz im Alarmton und setzt eine Kante', () => {
    render(<GrossKennzahl titel="Aufträge offen" wert={5} notiz="1 überfällig" ton="alarm" />);
    expect(zelle().dataset.ton).toBe('alarm');
    expect(screen.getByText('5')).toHaveStyle({ color: farbenHell.alarmText });
    expect(screen.getByText('1 überfällig')).toHaveStyle({ color: farbenHell.alarmText });
    // Die Kante (Innenschatten mit `calc(var(…))`) verwirft jsdom; sie prüft `e2e/grossbild.spec.ts`.
  });

  it('zeigt beim Laden einen Platzhalter statt einer Zahl', () => {
    render(<GrossKennzahl titel="Betroffene" wert={0} zustand="laden" ton="alarm" />);
    expect(zelle()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText('wird abgerufen')).toBeInTheDocument();
    // Ein ladender Wert behauptet keinen Ton.
    expect(zelle().dataset.ton).toBe('neutral');
  });

  it('zeigt bei einem Fehler „?“ mit „Stand unbekannt“, nie 0', () => {
    render(<GrossKennzahl titel="Betroffene" wert={0} zustand="fehler" />);
    expect(screen.getByText('?')).toBeInTheDocument();
    expect(screen.getByText('Stand unbekannt')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('führt nirgendwohin', () => {
    const { container } = render(<GrossKennzahl titel="Betroffene" wert={248} />);
    expect(container.querySelector('a, button')).toBeNull();
  });
});
