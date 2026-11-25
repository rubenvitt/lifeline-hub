import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import FremdebeneUebernehmenDialog from './FremdebeneUebernehmenDialog';

describe('Dialog „Übernehmen als …“ (LLH-2129)', () => {
  it('Fläche: vier Arten, Gefahrengebiet vorgewählt', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <FremdebeneUebernehmenDialog
        offen
        art="flaeche"
        anzahl={1}
        laeuft={false}
        onBestaetigen={onBestaetigen}
        onAbbrechen={vi.fn()}
      />,
    );
    const arten = screen.getAllByRole('radio');
    expect(arten.map((r) => r.closest('label')?.textContent)).toEqual([
      'Gefahrengebiet',
      'Absperrbereich',
      'Sperrgebiet',
      'Freie Skizze',
    ]);
    expect(screen.getByRole('radio', { name: 'Gefahrengebiet' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onBestaetigen).toHaveBeenCalledWith('gefahrengebiet');
  });

  it('Linie: Absperrgrenze vorgewählt, Wahl wird übergeben, Anzahl steht im Text', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <FremdebeneUebernehmenDialog
        offen
        art="linie"
        anzahl={3}
        laeuft={false}
        onBestaetigen={onBestaetigen}
        onAbbrechen={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Absperrgrenze' })).toBeChecked();
    expect(screen.getByText(/3 Teile/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Freie Skizze' }));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onBestaetigen).toHaveBeenCalledWith('freie_skizze');
  });
});
