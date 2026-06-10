// src/etb/SlashMenu.test.tsx
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { EtbBaustein } from '../api/types';
import { renderMitProviders } from '../test/utils';
import SlashMenu, { type SlashMenuHandle } from './SlashMenu';

const bausteine: EtbBaustein[] = [
  { id: 1, label: 'Lagemeldung', typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: 0 },
];

describe('SlashMenu', () => {
  it('zeigt Felder- und Bausteine-Sektion und wählt per Klick', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <SlashMenu offen filter="" bausteine={bausteine} gesetzteFelder={[]} onWahl={onWahl} onSchliessen={vi.fn()} />,
    );
    expect(screen.getByText('Felder')).toBeInTheDocument();
    expect(screen.getByText('Bausteine')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Ereigniszeit'));
    expect(onWahl).toHaveBeenCalledWith({ art: 'feld', key: 'ereigniszeit', label: 'Ereigniszeit', gesetzt: false });
  });

  it('filtert und wählt den ersten Treffer per Enter (über externes keydown)', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <SlashMenu offen filter="lage" bausteine={bausteine} gesetzteFelder={[]} onWahl={onWahl} onSchliessen={vi.fn()} />,
    );
    expect(screen.queryByText('Ereigniszeit')).toBeNull();
    expect(screen.getByText('Lagemeldung')).toBeInTheDocument();
  });

  it('Tastatur-Nav: ArrowDown + Enter wählt den zweiten Eintrag; Escape schließt', () => {
    const onWahl = vi.fn();
    const onSchliessen = vi.fn();
    const ref = createRef<SlashMenuHandle>();
    renderMitProviders(
      <SlashMenu ref={ref} offen filter="" bausteine={bausteine} gesetzteFelder={[]} onWahl={onWahl} onSchliessen={onSchliessen} />,
    );
    // flach = [ereigniszeit, von, an, meldeweg, veranlassung, ...bausteine]
    act(() => { ref.current!.handleKey('ArrowDown'); });
    act(() => { ref.current!.handleKey('Enter'); });
    expect(onWahl).toHaveBeenCalledWith(expect.objectContaining({ art: 'feld', key: 'von' }));
    act(() => { expect(ref.current!.handleKey('Escape')).toBe(true); });
    expect(onSchliessen).toHaveBeenCalled();
  });

  it('rendert nichts, wenn geschlossen', () => {
    const { container } = renderMitProviders(
      <SlashMenu offen={false} filter="" bausteine={bausteine} gesetzteFelder={[]} onWahl={vi.fn()} onSchliessen={vi.fn()} />,
    );
    expect(container.querySelector('[data-testid="slash-menu"]')).toBeNull();
  });
});
