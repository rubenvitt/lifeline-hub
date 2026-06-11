import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import HeraufstufenModal from './HeraufstufenModal';
import type { ChatNachricht } from '../api/types';

const nachricht: ChatNachricht = {
  id: 1, einsatz_id: 7, kanal_id: 1, autor_id: 1, autor_name: 'Max',
  inhalt: 'Deich instabil', erstellt_at: '2026-06-10 10:00:00',
  bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null,
};

describe('HeraufstufenModal', () => {
  it('übernimmt den Nachrichtentext und bestätigt mit Typ + Text', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <HeraufstufenModal offen nachricht={nachricht} senden={false}
        onAbbrechen={vi.fn()} onBestaetigen={onBestaetigen} />,
    );
    expect(screen.getByDisplayValue('Deich instabil')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Heraufstufen' }));
    expect(onBestaetigen).toHaveBeenCalledWith('meldung', 'Deich instabil');
  });
});
