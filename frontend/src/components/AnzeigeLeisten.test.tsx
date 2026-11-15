/**
 * Die Gruppe „Anzeige“ außerhalb des Benutzermenüs (LLH-1730, Spec `benutzermenue`, „Anzeige auch
 * in den Einsatz-Einstellungen und im Profil“). Dort trägt der Paneeltitel die Überschrift; die
 * Gruppe heißt für Hilfstechnik weiter „Anzeige“, und eine Wahl wirkt sofort bis ans `<html>`.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import AnzeigeLeisten from './AnzeigeLeisten';

afterEach(() => {
  delete document.documentElement.dataset.dichte;
  delete document.documentElement.dataset.theme;
});

describe('AnzeigeLeisten', () => {
  it('mit Überschrift: sichtbares „Anzeige“ benennt die Gruppe', () => {
    renderMitProviders(
      <ThemeModeProvider>
        <AnzeigeLeisten />
      </ThemeModeProvider>,
    );
    const gruppe = screen.getByRole('group', { name: 'Anzeige' });
    expect(within(gruppe).getByText('Anzeige')).toBeInTheDocument();
  });

  it('ohne Überschrift: kein sichtbares „Anzeige“, die Gruppe heißt trotzdem so', () => {
    renderMitProviders(
      <ThemeModeProvider>
        <AnzeigeLeisten hasTitel={false} />
      </ThemeModeProvider>,
    );
    const gruppe = screen.getByRole('group', { name: 'Anzeige' });
    expect(within(gruppe).queryByText('Anzeige')).toBeNull();
    // Gegenprobe mit derselben Gruppe: die drei Leisten stehen darin.
    for (const name of ['Darstellung', 'Bediendichte', 'Helligkeit in %']) {
      expect(within(gruppe).getByRole('radiogroup', { name })).toBeInTheDocument();
    }
  });

  it('eine Wahl wirkt sofort bis ans <html>', async () => {
    renderMitProviders(
      <ThemeModeProvider>
        <AnzeigeLeisten hasTitel={false} />
      </ThemeModeProvider>,
    );
    const dichte = within(screen.getByRole('radiogroup', { name: 'Bediendichte' }));
    await userEvent.click(dichte.getByRole('radio', { name: 'Handschuh' }));
    expect(dichte.getByRole('radio', { name: 'Handschuh' })).toBeChecked();
    expect(document.documentElement.dataset.dichte).toBe('handschuh');
  });
});
