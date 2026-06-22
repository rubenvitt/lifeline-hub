import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import SprechgruppenPicker from './SprechgruppenPicker';
import type { Sprechgruppe } from '../api/types';

vi.mock('../api/sprechgruppen', () => ({
  listeEinsatzSprechgruppen: vi.fn(),
  legeEinsatzSprechgruppeAn: vi.fn(),
}));

import { listeEinsatzSprechgruppen, legeEinsatzSprechgruppeAn } from '../api/sprechgruppen';

const MOCK_LISTE: Sprechgruppe[] = [
  {
    id: 1, einsatz_id: null, einsatz_lokal: false, bezeichnung: '412',
    betriebsart: 'TMO', hinweis: null, aktiv: true, sortier: 1,
  },
  {
    id: 2, einsatz_id: null, einsatz_lokal: false, bezeichnung: 'DMO 31',
    betriebsart: 'DMO', hinweis: null, aktiv: true, sortier: 2,
  },
];

describe('SprechgruppenPicker', () => {
  it('listet Sprechgruppen im Multi-Select und meldet die Auswahl', async () => {
    vi.mocked(listeEinsatzSprechgruppen).mockResolvedValue(MOCK_LISTE);

    const onChange = vi.fn();
    renderMitProviders(<SprechgruppenPicker einsatzId={5} value={[]} onChange={onChange} />);

    // Multi-Select öffnen (einzige combobox, solange das Anlegen-Formular zu ist)
    const select = screen.getByRole('combobox');
    await userEvent.click(select);

    // Optionen erscheinen erst beim Öffnen; '412' anklicken → ids = [1]
    await userEvent.click(await screen.findByText('412'));
    expect(onChange).toHaveBeenCalledWith([1]);
  });

  it('legt eine einsatz-lokale Sprechgruppe an und hakt sie an (ohne Form-Submit/Reload)', async () => {
    vi.mocked(listeEinsatzSprechgruppen).mockResolvedValue(MOCK_LISTE);
    const neueSprechgruppe: Sprechgruppe = {
      id: 9, einsatz_id: 5, einsatz_lokal: true, bezeichnung: 'Sonder 1',
      betriebsart: 'DMO', hinweis: null, aktiv: true, sortier: 10,
    };
    vi.mocked(legeEinsatzSprechgruppeAn).mockResolvedValue(neueSprechgruppe);

    const onChange = vi.fn();
    renderMitProviders(<SprechgruppenPicker einsatzId={5} value={[]} onChange={onChange} />);

    // Inline-Anlegen aufklappen
    await userEvent.click(await screen.findByRole('button', { name: /neue sprechgruppe anlegen/i }));

    // Bezeichnung eingeben
    await userEvent.type(screen.getByLabelText('Neue Bezeichnung'), 'Sonder 1');

    // Betriebsart wählen: zweite combobox (nach dem Multi-Select) öffnen, Option 'DMO' klicken
    const comboboxen = screen.getAllByRole('combobox');
    await userEvent.click(comboboxen[1]); // [0] = Multi-Select, [1] = Betriebsart
    // Den Options-CONTENT-Knoten klicken (der role=option-Wrapper committet in antd nicht zuverlässig)
    const dmoOption = await screen.findByText(
      (_, el) => el?.className === 'ant-select-item-option-content' && el?.textContent === 'DMO',
    );
    await userEvent.click(dmoOption);

    // Anlegen (reiner onClick-Button, kein Submit)
    await userEvent.click(screen.getByRole('button', { name: /^anlegen$/i }));

    await vi.waitFor(() => {
      expect(legeEinsatzSprechgruppeAn).toHaveBeenCalledWith(5, { bezeichnung: 'Sonder 1', betriebsart: 'DMO' });
      expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([9]));
    });
  });
});
