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

/**
 * Review vor dem PR (LLH-1808): die Leiste ist eine Segmentleiste als Reiter mit Reiterfläche.
 * `aria-controls` nur dort, wo der Inhalt auf der Seite steht; die Pfeiltaste bewegt nur den
 * Fokus (wie vorher bei antds Tabs), gewählt wird mit Enter.
 */
describe('FernmeldewesenReiter als Segmentleiste', () => {
  it('verbindet die Darstellungen mit der Fläche, den Kommunikationsplan nicht', () => {
    renderMitProviders(
      <>
        <FernmeldewesenReiter
          einsatzId={7}
          aktiv="tabelle"
          onDarstellung={vi.fn()}
          flaecheId="blatt"
        />
        <div role="tabpanel" id="blatt" aria-label="Funkplan" />
      </>,
      { route: '/einsaetze/7/fernmeldewesen' },
    );
    for (const name of ['Funkplan', 'Fernmeldeskizze', 'Sprechgruppen']) {
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-controls', 'blatt');
    }
    expect(screen.getByRole('tab', { name: 'Kommunikationsplan' })).not.toHaveAttribute(
      'aria-controls',
    );
  });

  it('die Pfeiltaste bewegt nur den Fokus, Enter wählt', async () => {
    const onDarstellung = vi.fn();
    renderMitProviders(
      <FernmeldewesenReiter einsatzId={7} aktiv="tabelle" onDarstellung={onDarstellung} />,
      { route: '/einsaetze/7/fernmeldewesen' },
    );
    screen.getByRole('tab', { name: 'Funkplan' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Fernmeldeskizze' })).toHaveFocus();
    expect(onDarstellung).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(onDarstellung).toHaveBeenCalledWith('skizze');
  });
});
