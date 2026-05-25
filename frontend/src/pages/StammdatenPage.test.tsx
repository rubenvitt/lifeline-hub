import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import StammdatenPage from './StammdatenPage';
import ProfilPage from './ProfilPage';

describe('Globale Platzhalter-Seiten', () => {
  it('Stammdaten zeigt Titel und Platzhalter', () => {
    renderMitProviders(<StammdatenPage />);
    expect(screen.getByText(/Stammdaten/)).toBeInTheDocument();
  });

  it('Profil zeigt Titel und Platzhalter', () => {
    renderMitProviders(<ProfilPage />);
    expect(screen.getByText(/Profil/)).toBeInTheDocument();
  });
});
