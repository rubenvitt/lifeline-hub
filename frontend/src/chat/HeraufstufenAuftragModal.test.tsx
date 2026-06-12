import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import HeraufstufenAuftragModal from './HeraufstufenAuftragModal';
import type { ChatNachricht } from '../api/types';

function nachricht(over: Partial<ChatNachricht> = {}): ChatNachricht {
  return {
    id: 5, einsatz_id: 7, kanal_id: 1, autor_id: 1, autor_name: 'Max',
    inhalt: 'Tank 5000 anfordern', erstellt_at: '2026-06-10 10:00:00',
    bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null, auftrag_id: null, ...over,
  };
}

describe('HeraufstufenAuftragModal', () => {
  it('belegt den Auftragstext mit dem Nachrichtentext vor und legt mit Empfänger an', async () => {
    const onAnlegen = vi.fn();
    renderMitProviders(
      <HeraufstufenAuftragModal
        offen nachricht={nachricht()} abschnitte={[]} einheiten={[]} senden={false}
        onAbbrechen={vi.fn()} onAnlegen={onAnlegen} />,
    );
    // Chat-Text ist als Auftragstext vorbelegt (LFH-101).
    expect(screen.getByLabelText('Auftrag / Was')).toHaveValue('Tank 5000 anfordern');

    await userEvent.type(screen.getByPlaceholderText(/Fachberater/), 'S4');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    expect(onAnlegen).toHaveBeenCalledWith(expect.objectContaining({
      auftrag_text: 'Tank 5000 anfordern',
      empfaenger: [expect.objectContaining({ empfaenger_typ: 'funktion', funktion_text: 'S4' })],
    }));
  });
});
