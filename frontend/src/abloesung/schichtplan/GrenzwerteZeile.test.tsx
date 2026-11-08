import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SchichtplanGrenzwerte } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import GrenzwerteZeile from './GrenzwerteZeile';

/** Lesezeile des Schichtplans (LLH-1603): nennt die Grenzwerte, bedient sie nicht. */

const VORGABEN: SchichtplanGrenzwerte = {
  max_dienst_minuten: 720,
  min_ruhe_minuten: 480,
  max_dienst_eigen: false,
  min_ruhe_eigen: false,
};

describe('GrenzwerteZeile (LLH-1603)', () => {
  it('nennt beide Werte und kennzeichnet die Vorgabe', () => {
    renderMitProviders(<GrenzwerteZeile einsatzId={1} grenzwerte={VORGABEN} darfSchreiben />);
    expect(
      screen.getByText('Höchstdienst 12 h (Vorgabe) · Mindestruhe 8 h (Vorgabe)'),
    ).toBeInTheDocument();
  });

  it('springt mit Schreibrecht über „ändern“ in die Einstellungen der Ablösung', () => {
    renderMitProviders(<GrenzwerteZeile einsatzId={7} grenzwerte={VORGABEN} darfSchreiben />);
    expect(screen.getByRole('link', { name: 'Dienst und Ruhe ändern' })).toHaveAttribute(
      'href',
      '/einsaetze/7/einstellungen/abloesung',
    );
  });

  it('ohne Schreibrecht kein Sprung', () => {
    renderMitProviders(
      <GrenzwerteZeile
        einsatzId={1}
        grenzwerte={{ ...VORGABEN, max_dienst_minuten: 600, max_dienst_eigen: true }}
        darfSchreiben={false}
      />,
    );
    expect(screen.getByText('Höchstdienst 10 h · Mindestruhe 8 h (Vorgabe)')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
