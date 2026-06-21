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
  it('rendert nach Betriebsart gruppierte Checkboxen und meldet Auswahl', async () => {
    vi.mocked(listeEinsatzSprechgruppen).mockResolvedValue(MOCK_LISTE);

    const onChange = vi.fn();
    renderMitProviders(
      <SprechgruppenPicker einsatzId={5} value={[]} onChange={onChange} />,
    );

    // Gruppenüberschriften
    await screen.findByText('TMO');
    await screen.findByText('DMO 31');

    // Checkbox für '412' anklicken — erwartet [1] als ids
    await userEvent.click(screen.getByLabelText('412'));
    expect(onChange).toHaveBeenCalledWith([1]);
  });

  it('legt einsatz-lokale Sprechgruppe an und hakt sie an', async () => {
    vi.mocked(listeEinsatzSprechgruppen).mockResolvedValue(MOCK_LISTE);
    const neueSprechgruppe: Sprechgruppe = {
      id: 9, einsatz_id: 5, einsatz_lokal: true, bezeichnung: 'Sonder 1',
      betriebsart: 'DMO', hinweis: null, aktiv: true, sortier: 10,
    };
    vi.mocked(legeEinsatzSprechgruppeAn).mockResolvedValue(neueSprechgruppe);

    const onChange = vi.fn();
    renderMitProviders(
      <SprechgruppenPicker einsatzId={5} value={[]} onChange={onChange} />,
    );

    // Warten bis geladen
    await screen.findByText('412');

    // "+ neue Sprechgruppe" anklicken
    await userEvent.click(screen.getByRole('button', { name: /neue sprechgruppe/i }));

    // Bezeichnung eingeben
    await userEvent.type(screen.getByLabelText(/bezeichnung/i), 'Sonder 1');

    // Betriebsart-Select: combobox öffnen und DMO-Option klicken
    const betriebsartCombobox = screen.getByRole('combobox', { name: /betriebsart/i });
    await userEvent.click(betriebsartCombobox);
    const dmoOption = await screen.findByText(
      (_, el) =>
        typeof el?.className === 'string' &&
        el.className.includes('ant-select-item-option-content') &&
        el.textContent === 'DMO – Direct Mode',
    );
    await userEvent.click(dmoOption);

    // Speichern
    await userEvent.click(screen.getByRole('button', { name: /speichern/i }));

    // onChange muss mit Array aufgerufen worden sein, das 9 enthält
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([9]));
    });
  });
});
