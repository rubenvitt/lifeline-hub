import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import ModulGesperrt from './ModulGesperrt';
import { modulRegistry } from './modulRegistry';

/** Hinweis des Modulwächters (LFH-888, Spec `modul-freigabe`). */
const lagemeldungen = modulRegistry.find((m) => m.key === 'lagemeldungen')!;

function PfadAnzeige() {
  return <span data-testid="pfad">{useLocation().pathname}</span>;
}

function rendern(ausgeblendet: boolean) {
  return renderMitProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <ModulGesperrt
              modul={lagemeldungen}
              ausgeblendet={ausgeblendet}
              rueckweg={{ pfad: '/einsaetze/7/ueberblick', label: 'Überblick öffnen' }}
            />
            <PfadAnzeige />
          </>
        }
      />
    </Routes>,
    { route: '/einsaetze/7/lagemeldungen' },
  );
}

describe('ModulGesperrt (LFH-888)', () => {
  it('nennt das Modul als Hauptüberschrift und „Keine Berechtigung“ als Grund', () => {
    rendern(false);
    expect(screen.getByRole('heading', { level: 1, name: /Lagemeldungen/ })).toBeInTheDocument();
    expect(screen.getByText('Keine Berechtigung')).toBeInTheDocument();
    expect(
      screen.getByText(/für deine Rolle in diesem Einsatz nicht freigegeben/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ausgeblendet/)).not.toBeInTheDocument();
  });

  it('Gliederung: das h1 steht vor der Paneel-Überschrift (h2)', () => {
    rendern(false);
    const ebenen = screen.getAllByRole('heading').map((h) => h.tagName);
    expect(ebenen).toEqual(['H1', 'H2']);
  });

  it('ein ausgeblendetes Modul heißt „ausgeblendet“, nicht „nicht freigegeben“', () => {
    rendern(true);
    expect(screen.getByText(/in diesem Einsatz ausgeblendet/)).toBeInTheDocument();
    expect(screen.queryByText(/nicht freigegeben/)).not.toBeInTheDocument();
  });

  it('genau eine Primäraktion: der Rückweg navigiert', async () => {
    rendern(false);
    const knoepfe = screen.getAllByRole('button');
    expect(knoepfe).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Überblick öffnen' }));
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/ueberblick');
  });
});
