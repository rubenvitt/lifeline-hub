import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import KreisSteuerung from './KreisSteuerung';

function rendere(p: Partial<Parameters<typeof KreisSteuerung>[0]> = {}) {
  const props = {
    aktiv: true,
    typ: 'absperrbereich' as const,
    onTyp: vi.fn(),
    mitte: null,
    mitteText: null,
    onMitte: vi.fn(),
    radiusM: null,
    onRadius: vi.fn(),
    onUebernehmen: vi.fn(),
    onAbbrechen: vi.fn(),
    ...p,
  };
  renderMitProviders(<KreisSteuerung {...props} />);
  return props;
}

/** Kreis-Band (LLH-1043, design.md D5): Zahl und Schnellwahl als Hauptweg, keine Erklärtexte. */
describe('KreisSteuerung', () => {
  it('rendert nichts, wenn nicht aktiv', () => {
    rendere({ aktiv: false });
    expect(document.querySelector('[data-lfh="kreis-steuerung"]')).toBeNull();
  });

  it('Schnellwahl 50/100/300/500/1000 m setzt den Radius, die gewählte ist gedrückt', () => {
    const p = rendere({ radiusM: 300 });
    for (const r of [50, 100, 300, 500, 1000])
      expect(screen.getByRole('button', { name: `${r} m` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '300 m' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '500 m' }));
    expect(p.onRadius).toHaveBeenCalledWith(500);
  });

  it('„Übernehmen“ erst mit Mitte und gültigem Radius', () => {
    rendere({ radiusM: 300 });
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  });

  it('mit Mitte und Radius übernimmt der Knopf; die Mitte steht als Text', () => {
    const p = rendere({
      mitte: { lat: 54, lon: 9.5 },
      mitteText: '54,00000° N 9,50000° O',
      radiusM: 300,
    });
    expect(screen.getByText('54,00000° N 9,50000° O')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(p.onUebernehmen).toHaveBeenCalledTimes(1);
  });

  it('Einsatzort und Suchnadel nur, wenn vorhanden; sie setzen die Mitte', () => {
    const p = rendere({ einsatzort: { lat: 50, lon: 8 } });
    expect(screen.queryByRole('button', { name: 'Suchnadel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Einsatzort' }));
    expect(p.onMitte).toHaveBeenCalledWith({ lat: 50, lon: 8 });
  });

  it('ohne Mitte trägt „Abbrechen“ die Esc-Kappe, mit Mitte nicht (D7)', () => {
    rendere();
    expect(screen.getByRole('button', { name: /Abbrechen/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'Escape',
    );
  });

  it('kein Satz über die Bedienung (LFH-1078)', () => {
    rendere();
    expect(document.body).not.toHaveTextContent(/[Tt]ippen|[Kk]licken|ziehen Sie/);
  });

  // LLH-1344, design.md D3: der Kreis einer bestehenden Zone.
  it('bearbeiten: Art als Text, „Übernehmen“ erst mit Änderung, Esc-Kappe nur ohne', () => {
    rendere({
      bearbeiten: { geaendert: false },
      mitte: { lat: 54, lon: 9.5 },
      mitteText: '54,00000° N 9,50000° O',
      radiusM: 300,
    });
    expect(screen.queryByRole('combobox', { name: 'Art' })).toBeNull();
    expect(screen.getByText('Absperrbereich')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Abbrechen/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'Escape',
    );
  });

  it('bearbeiten mit Änderung: „Übernehmen“ frei, Esc verwirft erst', () => {
    const p = rendere({
      bearbeiten: { geaendert: true },
      mitte: { lat: 54.001, lon: 9.5 },
      mitteText: '54,00100° N 9,50000° O',
      radiusM: 300,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(p.onUebernehmen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Abbrechen/ })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
  });
});
