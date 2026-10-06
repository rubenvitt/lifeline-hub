import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite, setzeViewportZurueck } from '../test/viewport';
import BetroffeneZeile from './BetroffeneZeile';

/**
 * Der Kürzel-Hinweis der Erfassungszeile (LFH-963, design.md D6): ab `md` steht er offen, unter
 * `md` klappt er hinter „Kürzel anzeigen“ ein — drei Zeilen Kürzel kosteten am Handy den Platz
 * der ersten Person. Die Breiten als Literale (390 Handschirm, 1180 Tablet quer).
 */

afterEach(() => setzeViewportZurueck());

function zeige() {
  return renderMitProviders(<BetroffeneZeile uhsListe={[]} onErfassen={vi.fn()} />);
}

describe('BetroffeneZeile — Kürzel-Hinweis', () => {
  it('steht ab md offen, ohne Umschalter', () => {
    setzeViewportBreite(1180);
    zeige();
    expect(screen.getByText('m/w/d + Alter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kürzel anzeigen' })).not.toBeInTheDocument();
  });

  it('klappt unter md ein und auf Wunsch wieder auf — derselbe Knopf, der Fokus bleibt', async () => {
    setzeViewportBreite(390);
    zeige();
    const kuerzel = () => screen.getByText('m/w/d + Alter').parentElement!;
    // Eingeklappt: aus dem Bild (Vorleser-Stil), aber weiter die Beschreibung des Felds.
    expect(kuerzel()).toHaveStyle({ position: 'absolute' });
    expect(screen.getByRole('textbox', { name: 'Kurzeingabe Person' })).toHaveAccessibleDescription(
      expect.stringContaining('m/w/d + Alter'),
    );
    const knopf = screen.getByRole('button', { name: 'Kürzel anzeigen' });
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(knopf);
    expect(kuerzel()).not.toHaveStyle({ position: 'absolute' });
    expect(knopf).toHaveAccessibleName('Kürzel ausblenden');
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    expect(knopf).toHaveFocus();
    // Der Knopf selbst gehört nicht zur Feldbeschreibung.
    expect(
      screen.getByRole('textbox', { name: 'Kurzeingabe Person' }),
    ).not.toHaveAccessibleDescription(expect.stringContaining('Kürzel ausblenden'));
    await userEvent.click(knopf);
    expect(kuerzel()).toHaveStyle({ position: 'absolute' });
  });
});
