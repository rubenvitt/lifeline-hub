import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import Platzhalter from './Platzhalter';

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
});
