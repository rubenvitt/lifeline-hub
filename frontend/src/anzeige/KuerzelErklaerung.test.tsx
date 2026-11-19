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

  // Schmale Spalten (Druckblatt des Meldebilds): Umbruch nur vor der Summe, nie an jedem Strich.
  it('umbruchVorSumme bricht nur vor „//Σ“', () => {
    zeige(<StaerkeSchreibweise umbruchVorSumme />);
    const knopf = screen.getByRole('button', { name: STAERKE_NAME });
    expect(knopf).toHaveTextContent('F/UF/M//Σ');
    expect(knopf.querySelectorAll('wbr')).toHaveLength(1);
    expect([...knopf.querySelectorAll('span')].map((t) => t.textContent)).toEqual([
      'F/UF/M',
      '//Σ',
    ]);
  });

  // Review B1: ein Verweis im Fenster muss Umgebungen erreichen, die bei Verweisen schließen
  // (Sprungpalette, `command-palette/AGENTS.md`); das Fenster selbst geht zu.
  it('der Link im Fenster reicht seinen Klick weiter und schließt das Fenster', async () => {
    const umgebung = vi.fn();
    zeige(
      <div onClick={umgebung}>
        <StaerkeSchreibweise />
      </div>,
    );
    const knopf = screen.getByRole('button', { name: STAERKE_NAME });
    await userEvent.click(knopf);
    await userEvent.click(await screen.findByRole('link', { name: 'Zeiten und Kürzel' }));
    expect(umgebung).toHaveBeenCalledTimes(1);
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
  });

  // Review B2: geschlossen gehören Esc und Pfeile der Umgebung (Palette: Esc/← zurück).
  it('geschlossen reicht der Knopf Escape und Pfeile weiter', async () => {
    const taste = vi.fn();
    zeige(
      <div onKeyDown={(e) => taste(e.key)}>
        <StaerkeSchreibweise />
      </div>,
    );
    screen.getByRole('button', { name: STAERKE_NAME }).focus();
    await userEvent.keyboard('{Escape}{ArrowLeft}');
    expect(taste.mock.calls).toEqual([['Escape'], ['ArrowLeft']]);
  });

  it('Enter und Leertaste bleiben am Knopf (kein Sortieren im Tabellenkopf)', async () => {
    const taste = vi.fn();
    zeige(
      <div onKeyDown={(e) => taste(e.key)}>
        <StaerkeSchreibweise />
      </div>,
    );
    screen.getByRole('button', { name: STAERKE_NAME }).focus();
    await userEvent.keyboard('{Enter}');
    expect(taste).not.toHaveBeenCalled();
  });

  // Review B8: das Fenster hängt im Portal am Ende der Seite; ohne Fokuswechsel wäre der Link erst
  // nach der ganzen Seite erreichbar.
  it('geöffnet liegt der Fokus auf dem Link, Escape bringt ihn zurück', async () => {
    zeige(<StaerkeSchreibweise />);
    const knopf = screen.getByRole('button', { name: STAERKE_NAME });
    knopf.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Zeiten und Kürzel' })).toHaveFocus(),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(knopf).toHaveFocus());
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
  });
});
