import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { renderMitProviders } from '../test/utils';
import FernmeldewesenReiter, { FERNMELDEWESEN_REITER } from './FernmeldewesenReiter';

function PfadAnzeige() {
  const { pathname, search } = useLocation();
  return <span data-testid="pfad">{`${pathname}${search}`}</span>;
}

/**
 * Reiter des Moduls Fernmeldewesen (LLH-1180, design.md D5): Funkplan, Fernmeldeskizze und
 * Sprechgruppen sind Darstellungen EINER Seite, der Kommunikationsplan eine eigene Route.
 */
describe('FernmeldewesenReiter', () => {
  it('führt die vier Reiter in der Reihenfolge der Spec', () => {
    expect(FERNMELDEWESEN_REITER.map((r) => r.label)).toEqual([
      'Funkplan',
      'Fernmeldeskizze',
      'Sprechgruppen',
      'Kommunikationsplan',
    ]);
  });

  it('auf dem Funkplan setzt ein Darstellungsreiter die Darstellung, ohne zu navigieren', async () => {
    const onDarstellung = vi.fn();
    renderMitProviders(
      <Routes>
        <Route
          path="/einsaetze/:id/fernmeldewesen"
          element={
            <>
              <FernmeldewesenReiter einsatzId={7} aktiv="tabelle" onDarstellung={onDarstellung} />
              <PfadAnzeige />
            </>
          }
        />
      </Routes>,
      { route: '/einsaetze/7/fernmeldewesen' },
    );
    expect(screen.getByRole('tab', { name: 'Funkplan', selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Fernmeldeskizze' }));
    expect(onDarstellung).toHaveBeenCalledWith('skizze');
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/fernmeldewesen');
  });

  it('der Reiter „Kommunikationsplan“ navigiert auf dessen Route', async () => {
    renderMitProviders(
      <Routes>
        <Route
          path="/einsaetze/:id/fernmeldewesen"
          element={<FernmeldewesenReiter einsatzId={7} aktiv="tabelle" onDarstellung={vi.fn()} />}
        />
        <Route path="/einsaetze/:id/fernmeldewesen/kommunikationsplan" element={<PfadAnzeige />} />
      </Routes>,
      { route: '/einsaetze/7/fernmeldewesen' },
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Kommunikationsplan' }));
    expect(await screen.findByTestId('pfad')).toHaveTextContent(
      '/einsaetze/7/fernmeldewesen/kommunikationsplan',
    );
  });

  it('aus dem Kommunikationsplan führt „Fernmeldeskizze“ auf den Funkplan mit Sichtvorgabe', async () => {
    renderMitProviders(
      <Routes>
        <Route
          path="/einsaetze/:id/fernmeldewesen/kommunikationsplan"
          element={<FernmeldewesenReiter einsatzId={7} aktiv="kommunikationsplan" />}
        />
        <Route path="/einsaetze/:id/fernmeldewesen" element={<PfadAnzeige />} />
      </Routes>,
      { route: '/einsaetze/7/fernmeldewesen/kommunikationsplan' },
    );
    expect(
      screen.getByRole('tab', { name: 'Kommunikationsplan', selected: true }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Fernmeldeskizze' }));
    expect(await screen.findByTestId('pfad')).toHaveTextContent(
      '/einsaetze/7/fernmeldewesen?ansicht=skizze',
    );
  });
});
