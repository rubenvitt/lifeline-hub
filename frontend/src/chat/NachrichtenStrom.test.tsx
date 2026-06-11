import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import NachrichtenStrom from './NachrichtenStrom';
import type { ChatNachricht } from '../api/types';

function nachricht(over: Partial<ChatNachricht> = {}): ChatNachricht {
  return {
    id: 1, einsatz_id: 7, kanal_id: 1, autor_id: 1, autor_name: 'Max',
    inhalt: 'Hallo Stab', erstellt_at: '2026-06-10 10:00:00',
    bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null, ...over,
  };
}

describe('NachrichtenStrom', () => {
  it('zeigt Inhalt und Autor', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht()]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} />,
    );
    expect(screen.getByText('Hallo Stab')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
  });

  it('zeigt Tombstone für gelöschte Nachrichten ohne Aktionen', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ inhalt: null, geloescht_at: '2026-06-10 10:05:00' })]}
        eigeneBenutzerId={1} darfSchreiben onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} />,
    );
    expect(screen.getByText('Nachricht gelöscht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  it('zeigt ETB-Badge bei heraufgestufter Nachricht', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ etb_eintrag_id: 42 })]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} />,
    );
    expect(screen.getByText(/heraufgestuft zu ETB/i)).toBeInTheDocument();
  });

  it('blendet Bearbeiten/Löschen bei fehlendem Schreibrecht aus (eigene Nachricht)', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ autor_id: 1 })]} eigeneBenutzerId={1} darfSchreiben={false}
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  it('Aktionen nur an eigenen Nachrichten; Heraufstufen löst Callback aus', async () => {
    const onHeraufstufen = vi.fn();
    renderMitProviders(
      <NachrichtenStrom
        nachrichten={[nachricht({ id: 1, autor_id: 1 }), nachricht({ id: 2, autor_id: 99, inhalt: 'fremd' })]}
        eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={onHeraufstufen} />,
    );
    expect(screen.getAllByRole('button', { name: 'Löschen' })).toHaveLength(1);
    const hochButtons = screen.getAllByRole('button', { name: 'Zu ETB' });
    await userEvent.click(hochButtons[0]);
    expect(onHeraufstufen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
