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

  it('klappt unter md ein und auf Wunsch wieder auf', async () => {
    setzeViewportBreite(390);
    zeige();
    expect(screen.queryByText('m/w/d + Alter')).not.toBeInTheDocument();
    const auf = screen.getByRole('button', { name: 'Kürzel anzeigen' });
    expect(auf).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(auf);
    expect(screen.getByText('m/w/d + Alter')).toBeInTheDocument();
    const zu = screen.getByRole('button', { name: 'Kürzel ausblenden' });
    expect(zu).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(zu);
    expect(screen.queryByText('m/w/d + Alter')).not.toBeInTheDocument();
  });
});
