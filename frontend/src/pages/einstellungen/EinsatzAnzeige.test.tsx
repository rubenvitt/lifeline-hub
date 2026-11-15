/**
 * Reiter „Anzeige“ der Einsatz-Einstellungen (LLH-1730, Spec `benutzermenue`, „Anzeige auch in
 * den Einsatz-Einstellungen und im Profil“; `bedien-dichte`, „Handschuh nur auf ausdrückliche
 * Wahl“). Eine Geräteeinstellung: kein Formular, kein Recht, sofort wirksam.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { ThemeModeProvider } from '../../theme/ThemeModeProvider';
import EinsatzAnzeige from './EinsatzAnzeige';

afterEach(() => {
  delete document.documentElement.dataset.dichte;
  delete document.documentElement.dataset.theme;
});

function zeige() {
  renderMitProviders(
    <ThemeModeProvider>
      <EinsatzAnzeige />
    </ThemeModeProvider>,
  );
}

describe('EinsatzAnzeige', () => {
  it('Paneel „Anzeige auf diesem Gerät“ mit Hinweis und den drei Leisten', () => {
    zeige();
    expect(screen.getByRole('heading', { name: 'Anzeige auf diesem Gerät' })).toBeInTheDocument();
    expect(
      screen.getByText('Gilt nur auf diesem Gerät, nicht für den Einsatz.'),
    ).toBeInTheDocument();
    const gruppe = screen.getByRole('group', { name: 'Anzeige' });
    for (const name of ['Darstellung', 'Bediendichte', 'Helligkeit in %']) {
      expect(within(gruppe).getByRole('radiogroup', { name })).toBeInTheDocument();
    }
  });

  it('„Handschuh“ wirkt sofort und bleibt nach dem Neuladen', async () => {
    zeige();
    const dichte = within(screen.getByRole('radiogroup', { name: 'Bediendichte' }));
    await userEvent.click(dichte.getByRole('radio', { name: 'Handschuh' }));
    expect(document.documentElement.dataset.dichte).toBe('handschuh');
    expect(localStorage.getItem('lifeline-hub.dichte')).toBe('handschuh');
  });

  it('keine Leiste ist gesperrt — die Wahl braucht kein Recht', () => {
    zeige();
    expect(screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-disabled'))).toEqual([]);
  });
});
