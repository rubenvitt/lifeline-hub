// frontend/src/command-palette/CommandPaletteProvider.test.tsx
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider } from './CommandPaletteProvider';

vi.mock('./useBefehle', () => ({
  useBefehle: () => [{ id: 'modul:etb', gruppe: 'module', label: 'ETB', ausfuehren: vi.fn() }],
}));

describe('CommandPaletteProvider', () => {
  it('öffnet die Palette mit STRG+K und schließt mit erneutem Druck', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPaletteProvider><div>App-Inhalt</div></CommandPaletteProvider>);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('öffnet die Palette auch mit CMD+K (Meta-Taste, AK1)', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPaletteProvider><div>App-Inhalt</div></CommandPaletteProvider>);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await u.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
