import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import CommandPaletteTrigger, { suchKuerzelFuerUserAgent } from './CommandPaletteTrigger';

vi.mock('../command-palette/useBefehle', () => ({ useBefehle: () => [] }));

function zeige() {
  return renderMitProviders(
    <CommandPaletteProvider>
      <CommandPaletteTrigger />
    </CommandPaletteProvider>,
  );
}

describe('CommandPaletteTrigger', () => {
  beforeEach(() => setzeViewportBreite(1024));

  it('öffnet die Palette per Klick und übergibt ihr den Fokus', async () => {
    const u = userEvent.setup();
    zeige();

    await u.click(screen.getByRole('button', { name: 'Suchen' }));

    expect(await screen.findByRole('combobox')).toHaveFocus();
  });

  it('zeigt breit Text und ein semantisches Plattformkürzel', () => {
    zeige();

    expect(screen.getByRole('button', { name: 'Suchen' })).toHaveTextContent('Suchen');
    expect(screen.getByText('Strg+K', { selector: 'kbd' })).toBeInTheDocument();
  });

  it('nutzt für das sichtbare Kürzel das Betriebssystem des Nutzers', () => {
    expect(suchKuerzelFuerUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('⌘K');
    expect(suchKuerzelFuerUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Strg+K');
  });

  it('bleibt unter lg eine benannte 48-px-Icon-Trefffläche mit Header-Vordergrundrolle', () => {
    setzeViewportBreite(390);
    zeige();

    const trigger = screen.getByRole('button', { name: 'Suchen' });
    expect(trigger).toHaveAttribute('aria-label', 'Suchen');
    expect(trigger.style.width).toBe('48px');
    expect(trigger.style.height).toBe('48px');
    expect(trigger.style.minWidth).toBe('48px');
    expect(trigger.style.minHeight).toBe('48px');
    expect(trigger.style.color).toBe('var(--lfh-kopf-vordergrund)');
    expect(trigger.querySelector('kbd')).toBeNull();
  });
});
