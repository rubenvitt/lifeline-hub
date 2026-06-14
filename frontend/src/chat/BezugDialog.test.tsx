import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import BezugDialog from './BezugDialog';
import type { BezugOptionen } from './bezug';
import type { ChatNachricht } from '../api/types';

const nachricht: ChatNachricht = {
  id: 1, einsatz_id: 7, kanal_id: 1, autor_id: 1, autor_name: 'Max',
  inhalt: 'Lage', erstellt_at: '2026-06-10 10:00:00',
  bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null, auftrag_id: null,
  bezug_typ: null, bezug_id: null, anhaenge: [],
};

const optionen: BezugOptionen = {
  schaden: [{ value: 3, label: 'S-003 · sachschaden · B5' }],
  uhs: [], person: [], lagebericht: [], meldung: [], auftrag: [],
};

describe('BezugDialog', () => {
  it('wählt Typ + Objekt und bestätigt mit (typ, zielId)', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <BezugDialog offen nachricht={nachricht} optionen={optionen} senden={false}
        onAbbrechen={vi.fn()} onBestaetigen={onBestaetigen} />,
    );

    const comboboxen = screen.getAllByRole('combobox');
    // Typ-Auswahl
    await userEvent.click(comboboxen[0]);
    await userEvent.click(await screen.findByText('Schaden'));
    // Objekt-Auswahl
    await userEvent.click(comboboxen[1]);
    await userEvent.click(await screen.findByText('S-003 · sachschaden · B5'));

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onBestaetigen).toHaveBeenCalledWith('schaden', 3);
  });

  it('füllt bei bestehendem Bezug vor (Ändern-Fall)', async () => {
    renderMitProviders(
      <BezugDialog offen nachricht={{ ...nachricht, bezug_typ: 'schaden', bezug_id: 3 }}
        optionen={optionen} senden={false} onAbbrechen={vi.fn()} onBestaetigen={vi.fn()} />,
    );
    // Das vorbefüllte Objekt-Label ist sichtbar.
    expect(await screen.findByText('S-003 · sachschaden · B5')).toBeInTheDocument();
  });
});
