import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import KuerzelErklaerung, { StaerkeSchreibweise } from './KuerzelErklaerung';

function zeige(knoten: React.ReactNode) {
  return render(<MemoryRouter>{knoten}</MemoryRouter>);
}

const STAERKE_NAME = /F\/UF\/M\/\/Σ.*Führer \/ Unterführer \/ Mannschaft \/\/ Summe/;

describe('KuerzelErklaerung (LLH-1825)', () => {
  it('zeigt das Kürzel als Knopf mit Bedeutung im Namen', () => {
    zeige(<StaerkeSchreibweise />);
    const knopf = screen.getByRole('button', { name: STAERKE_NAME });
    expect(knopf).toHaveTextContent('F/UF/M//Σ');
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
  });

  it('öffnet per Klick die Erklärung mit Beispiel und Link', async () => {
    zeige(<StaerkeSchreibweise />);
    const knopf = screen.getByRole('button', { name: STAERKE_NAME });
    await userEvent.click(knopf);
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(screen.getByText('Führer / Unterführer / Mannschaft // Summe (Stärke)')).toBeVisible(),
    );
    expect(
      screen.getByText(
        '1/2/5//8: ein Führer, zwei Unterführer, fünf Helferinnen und Helfer, zusammen acht',
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Zeiten und Kürzel' })).toHaveAttribute(
      'href',
      '/hilfe/zeiten-und-kuerzel',
    );
  });

  it('löst den Klick der Umgebung nicht aus', async () => {
    const umgebung = vi.fn();
    zeige(
      <div onClick={umgebung}>
        <StaerkeSchreibweise />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: STAERKE_NAME }));
    await userEvent.click(
      await screen.findByText('Führer / Unterführer / Mannschaft // Summe (Stärke)'),
    );
    expect(umgebung).not.toHaveBeenCalled();
  });

  it('Tastatur: Enter öffnet, Escape schließt und gibt den Fokus zurück', async () => {
    zeige(<StaerkeSchreibweise />);
    const knopf = screen.getByRole('button', { name: STAERKE_NAME });
    knopf.focus();
    await userEvent.keyboard('{Enter}');
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(knopf).toHaveAttribute('aria-expanded', 'false'));
    expect(knopf).toHaveFocus();
  });

  it('ohne Beispiel kein Beispielsatz', async () => {
    zeige(<KuerzelErklaerung kuerzel="UHS" />);
    await userEvent.click(screen.getByRole('button', { name: /UHS.*Unfallhilfsstelle/ }));
    await waitFor(() => expect(screen.getByText('Unfallhilfsstelle')).toBeVisible());
    expect(screen.queryByTestId('kuerzel-beispiel')).toBeNull();
  });

  it('children ersetzen den sichtbaren Text, die Bedeutung bleibt im Namen', () => {
    zeige(<StaerkeSchreibweise>F/UF/M · //Σ</StaerkeSchreibweise>);
    const knopf = screen.getByRole('button', { name: STAERKE_NAME });
    expect(knopf).toHaveTextContent('F/UF/M · //Σ');
  });
});
