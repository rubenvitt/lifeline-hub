// Fokusrückgabe beim Schließen (LLH-1915, WCAG 2.4.3): die Palette wird ausgehängt, nicht
// unsichtbar geschaltet, also läuft die Rückgabe von rc-dialog nie. Der Provider gibt den Fokus
// deshalb selbst zurück, an das mitgegebene Ziel oder an das Element, das ihn beim Öffnen hatte.
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider, useCommandPalette } from './CommandPaletteProvider';
import type { Befehl } from './typen';

const fokusZiel = { aktuell: null as HTMLElement | null };

vi.mock('./useBefehle', () => ({
  useBefehle: (): Befehl[] => [
    {
      id: 'navigation:etb',
      gruppe: 'module',
      label: 'Einsatztagebuch',
      ausfuehren: vi.fn(),
    },
    {
      id: 'tastatur:neu',
      gruppe: 'aktionen',
      label: 'Neue Zeile',
      // Eine Aktion, die den Fokus bewusst setzt (Erfassung, Rückfrage): sie behält ihn.
      ausfuehren: () => fokusZiel.aktuell?.focus(),
    },
  ],
}));
vi.mock('./useDatensaetze', () => ({ useDatensatzTreffer: () => [] }));

function Ausloeser({ mitZiel }: { mitZiel?: boolean }) {
  const { oeffne } = useCommandPalette();
  const griff = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={griff}>
        Griff
      </button>
      <button type="button" onClick={(e) => oeffne(mitZiel ? griff.current : e.currentTarget)}>
        Suchen
      </button>
      <input aria-label="Feld" />
      <input aria-label="Erfassung" ref={(el) => void (fokusZiel.aktuell = el)} />
    </>
  );
}

function app(mitZiel?: boolean) {
  return renderMitProviders(
    <CommandPaletteProvider>
      <Ausloeser mitZiel={mitZiel} />
    </CommandPaletteProvider>,
    { route: '/einsaetze/5/etb' },
  );
}

describe('CommandPaletteProvider · Fokusrückgabe (LLH-1915)', () => {
  it('gibt den Fokus nach Strg+K und Esc an das Feld zurück, das ihn vorher hatte', async () => {
    const u = userEvent.setup();
    app();
    const feld = screen.getByRole('textbox', { name: 'Feld' });
    feld.focus();

    await u.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    await u.keyboard('{Escape}');

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(feld).toHaveFocus();
  });

  it('gibt den Fokus an den Auslöser zurück, der sich beim Öffnen mitgibt', async () => {
    const u = userEvent.setup();
    app();
    const suchen = screen.getByRole('button', { name: 'Suchen' });
    // Wie Safari: der Klick fokussiert den Knopf nicht, der Fokus bleibt auf `body`.
    suchen.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await u.keyboard('{Escape}');

    expect(suchen).toHaveFocus();
  });

  it('gibt den Fokus an ein mitgegebenes anderes Ziel zurück', async () => {
    const u = userEvent.setup();
    app(true);
    await u.click(screen.getByRole('button', { name: 'Suchen' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await u.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Griff' })).toHaveFocus();
  });

  it('gibt den Fokus auch nach einer ausgeführten Zeile zurück', async () => {
    const u = userEvent.setup();
    app();
    const feld = screen.getByRole('textbox', { name: 'Feld' });
    feld.focus();
    await u.keyboard('{Control>}k{/Control}');
    await u.type(screen.getByRole('combobox'), 'Einsatztagebuch');

    await u.keyboard('{Enter}');

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(feld).toHaveFocus();
  });

  it('lässt den Fokus stehen, den eine ausgeführte Aktion selbst gesetzt hat', async () => {
    const u = userEvent.setup();
    app();
    screen.getByRole('textbox', { name: 'Feld' }).focus();
    await u.keyboard('{Control>}k{/Control}');
    await u.type(screen.getByRole('combobox'), 'Neue Zeile');

    await u.keyboard('{Enter}');

    expect(screen.getByRole('textbox', { name: 'Erfassung' })).toHaveFocus();
  });

  it('greift nicht, wenn das Ziel inzwischen aus dem Dokument verschwunden ist', async () => {
    const u = userEvent.setup();
    app();
    const feld = screen.getByRole('textbox', { name: 'Feld' });
    feld.focus();
    await u.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    feld.remove();

    await u.keyboard('{Escape}');

    expect(document.activeElement).toBe(document.body);
  });
});
