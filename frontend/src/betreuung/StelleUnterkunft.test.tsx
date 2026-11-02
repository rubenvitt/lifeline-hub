import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { renderMitProviders } from '../test/utils';
import StelleUnterkunft from './StelleUnterkunft';

/** Paneel „Unterkunft“ an der Betreuungsstelle (LLH-1520). */

function Ort() {
  return <output aria-label="Ort">{useLocation().pathname}</output>;
}

describe('StelleUnterkunft', () => {
  it('zeigt die Kapazität und führt in „Unterkunft planen“', async () => {
    renderMitProviders(
      <Routes>
        <Route
          path="/einsaetze/1/betreuung/8"
          element={<StelleUnterkunft einsatzId={1} stelleId={8} kapazitaet={150} />}
        />
        <Route path="*" element={<Ort />} />
      </Routes>,
      { route: '/einsaetze/1/betreuung/8' },
    );
    const paneel = screen.getByRole('region', { name: 'Unterkunft' });
    expect(paneel).toHaveTextContent('Kapazität 150');
    await userEvent.click(screen.getByRole('button', { name: /Unterkunft planen/ }));
    expect(screen.getByRole('status', { name: 'Ort' })).toHaveTextContent(
      '/einsaetze/1/betreuung/8/unterkunft',
    );
  });

  it('ohne Kapazität: „keine Kapazität festgelegt“', () => {
    renderMitProviders(<StelleUnterkunft einsatzId={1} stelleId={8} kapazitaet={null} />);
    expect(screen.getByText('keine Kapazität festgelegt')).toBeInTheDocument();
  });
});
