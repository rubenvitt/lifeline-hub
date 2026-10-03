import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import BearbeitenModal from './BearbeitenModal';
import type { ChatNachricht } from '../api/types';

const nachricht: ChatNachricht = {
  id: 1,
  einsatz_id: 7,
  kanal_id: 1,
  autor_id: 1,
  autor_name: 'Max',
  inhalt: 'Deich instabil',
  erstellt_at: '2026-06-10 10:00:00',
  bearbeitet_at: null,
  geloescht_at: null,
  etb_eintrag_id: null,
  auftrag_id: null,
  bezug_typ: null,
  bezug_id: null,
  anhaenge: [],
};

describe('BearbeitenModal', () => {
  it('befüllt mit dem aktuellen Nachrichtentext vor', () => {
    renderMitProviders(
      <BearbeitenModal
        offen
        nachricht={nachricht}
        senden={false}
        onAbbrechen={vi.fn()}
        onBestaetigen={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Deich instabil')).toBeInTheDocument();
  });

  it('bestätigt mit dem geänderten, getrimmten Text', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <BearbeitenModal
        offen
        nachricht={nachricht}
        senden={false}
        onAbbrechen={vi.fn()}
        onBestaetigen={onBestaetigen}
      />,
    );
    const feld = screen.getByDisplayValue('Deich instabil');
    await userEvent.clear(feld);
    await userEvent.type(feld, '  Deich gehalten  ');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onBestaetigen).toHaveBeenCalledWith('Deich gehalten');
  });

  it('blockiert das Speichern bei leerem Text', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <BearbeitenModal
        offen
        nachricht={nachricht}
        senden={false}
        onAbbrechen={vi.fn()}
        onBestaetigen={onBestaetigen}
      />,
    );
    await userEvent.clear(screen.getByDisplayValue('Deich instabil'));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onBestaetigen).not.toHaveBeenCalled();
  });
});

describe('BearbeitenModal — Erfassungshülle (LFH-796)', () => {
  it('liegt auf der Erfassungshülle: Knopf im Formular, keine Fußzeile, Fokus im Text', async () => {
    renderMitProviders(
      <BearbeitenModal
        offen
        nachricht={nachricht}
        senden={false}
        onAbbrechen={vi.fn()}
        onBestaetigen={vi.fn()}
      />,
    );
    const knopf = screen.getByRole('button', { name: 'Speichern' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    await waitFor(() => expect(screen.getByDisplayValue('Deich instabil')).toHaveFocus());
  });

  it('lässt den geänderten Text bei Ablehnung stehen', async () => {
    const onBestaetigen = vi.fn().mockRejectedValue(new Error('abgelehnt'));
    renderMitProviders(
      <BearbeitenModal
        offen
        nachricht={nachricht}
        senden={false}
        onAbbrechen={vi.fn()}
        onBestaetigen={onBestaetigen}
      />,
    );
    const feld = screen.getByDisplayValue('Deich instabil');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Deich gehalten');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onBestaetigen).toHaveBeenCalled());
    expect(screen.getByDisplayValue('Deich gehalten')).toBeInTheDocument();
  });
});
