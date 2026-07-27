import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import Platzhalter from './Platzhalter';

/** Sonde für den aktuellen Pfad — die Navigation des Rückweg-Knopfes ist beobachtbar,
 *  ohne `useNavigate` zu mocken (der Mock würde nur beweisen, dass ein Mock läuft). */
function PfadAnzeige() {
  return <span data-testid="pfad">{useLocation().pathname}</span>;
}

describe('Platzhalter', () => {
  it('zeigt Titel, Bauarbeiter-Marker und Beschreibung', () => {
    renderMitProviders(<Platzhalter titel="Stab" beschreibung="Kommt später." />);
    expect(screen.getByText(/Stab/)).toBeInTheDocument();
    expect(screen.getByText(/🚧/)).toBeInTheDocument();
    expect(screen.getByText('Kommt später.')).toBeInTheDocument();
  });

  it('funktioniert ohne Beschreibung', () => {
    renderMitProviders(<Platzhalter titel="Profil" />);
    expect(screen.getByText(/Profil/)).toBeInTheDocument();
  });

  it('nennt den Erwartungshorizont statt nur „In Arbeit“ (LFH-328)', () => {
    renderMitProviders(<Platzhalter titel="Stab" />);
    expect(screen.getByText(/noch nicht bedienbar/)).toBeInTheDocument();
  });

  it('bietet ohne Rückweg keinen Knopf an (Konsument ohne Einsatz-Kontext)', () => {
    renderMitProviders(<Platzhalter titel="Profil" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('navigiert per Primärknopf auf den übergebenen Rückweg (LFH-328)', async () => {
    renderMitProviders(
      <>
        <Platzhalter
          titel="Stab"
          rueckweg={{ pfad: '/einsaetze/7/lage-dashboard', label: 'Dashboard öffnen' }}
        />
        <PfadAnzeige />
      </>,
      { route: '/einsaetze/7/stab' },
    );
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/stab');
    await userEvent.click(screen.getByRole('button', { name: 'Dashboard öffnen' }));
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/lage-dashboard');
  });
});
